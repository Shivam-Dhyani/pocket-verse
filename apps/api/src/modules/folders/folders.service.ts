import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Folder, PrismaClient } from '@prisma/client';
import type {
  CreateFolderInput,
  DriveListing,
  FolderDto,
  UpdateFolderInput,
} from '@pocketverse/shared';
import type { JobQueue } from '../../lib/queue/index.js';
import { AppError } from '../../middleware/errors.js';
import { AuditEventTypes, type AuditService } from '../audit/audit.service.js';
import { toFileDto } from '../files/files.service.js';

const DELETE_BATCH_SIZE = 100;

export interface FoldersServiceDeps {
  prisma: PrismaClient;
  queue: JobQueue;
  audit: AuditService;
  stagingDir: string;
}

const notFound = () => new AppError(404, 'NOT_FOUND', 'Resource not found');

const duplicateName = () =>
  new AppError(409, 'DUPLICATE_NAME', 'Something with this name already exists here.');

export function createFoldersService({ prisma, queue, audit, stagingDir }: FoldersServiceDeps) {
  async function requireFolder(userId: string, folderId: string): Promise<Folder> {
    const folder = await prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder || folder.ownerId !== userId) {
      throw notFound();
    }
    return folder;
  }

  async function assertNameFree(
    userId: string,
    parentId: string | null,
    name: string,
    ignoreId?: string,
  ): Promise<void> {
    const existing = await prisma.folder.findFirst({
      where: { ownerId: userId, parentId, name },
    });
    if (existing && existing.id !== ignoreId) {
      throw duplicateName();
    }
  }

  /** Walks up from `startId` to the root; true if `needle` is on the path. */
  async function isDescendantOrSelf(
    userId: string,
    startId: string,
    needle: string,
  ): Promise<boolean> {
    let currentId: string | null = startId;
    for (let depth = 0; currentId && depth < 200; depth += 1) {
      if (currentId === needle) {
        return true;
      }
      const current: Folder | null = await prisma.folder.findUnique({ where: { id: currentId } });
      if (!current || current.ownerId !== userId) {
        throw notFound();
      }
      currentId = current.parentId;
    }
    return false;
  }

  return {
    async createFolder(userId: string, input: CreateFolderInput): Promise<FolderDto> {
      const parentId = input.parentId ?? null;
      if (parentId) {
        await requireFolder(userId, parentId);
      }
      await assertNameFree(userId, parentId, input.name);
      const folder = await prisma.folder.create({
        data: { name: input.name, parentId, ownerId: userId },
      });
      return toFolderDto(folder);
    },

    /**
     * Walk a folder path, creating missing segments and reusing existing ones.
     * Powers folder uploads: the client resolves each file's directory to a
     * real folder id so the tree is recreated exactly. Idempotent. Reports
     * which segments it CREATED (vs reused) so a cancelled upload can clean up
     * exactly the folders it introduced and nothing that existed before.
     */
    async ensureFolderPath(
      userId: string,
      parentId: string | null,
      segments: string[],
    ): Promise<{ folderId: string; createdIds: string[] }> {
      if (parentId) {
        await requireFolder(userId, parentId);
      }
      let currentId = parentId;
      const createdIds: string[] = [];
      for (const name of segments) {
        const existing = await prisma.folder.findFirst({
          where: { ownerId: userId, parentId: currentId, name },
        });
        if (existing) {
          currentId = existing.id;
        } else {
          const created = await prisma.folder.create({
            data: { name, parentId: currentId, ownerId: userId },
          });
          createdIds.push(created.id);
          currentId = created.id;
        }
      }
      if (!currentId) {
        throw new AppError(400, 'INVALID_PATH', 'A folder path must have at least one segment.');
      }
      return { folderId: currentId, createdIds };
    },

    async updateFolder(
      userId: string,
      folderId: string,
      input: UpdateFolderInput,
    ): Promise<FolderDto> {
      const folder = await requireFolder(userId, folderId);
      const targetParentId = input.parentId !== undefined ? input.parentId : folder.parentId;
      const targetName = input.name ?? folder.name;

      if (input.parentId !== undefined && input.parentId !== null) {
        // Moving into itself or any of its descendants would orbit forever.
        if (await isDescendantOrSelf(userId, input.parentId, folderId)) {
          throw new AppError(400, 'FOLDER_CYCLE', 'A folder cannot be moved inside itself.');
        }
      }
      await assertNameFree(userId, targetParentId, targetName, folderId);

      const updated = await prisma.folder.update({
        where: { id: folderId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        },
      });
      return toFolderDto(updated);
    },

    async deleteFolder(userId: string, folderId: string): Promise<void> {
      const root = await requireFolder(userId, folderId);

      // Collect the whole subtree breadth-first (names kept for the audit tree).
      const subtree = new Map<string, { id: string; name: string; parentId: string | null }>();
      subtree.set(root.id, { id: root.id, name: root.name, parentId: root.parentId });
      let frontier = [folderId];
      while (frontier.length > 0) {
        const children = await prisma.folder.findMany({
          where: { ownerId: userId, parentId: { in: frontier } },
          select: { id: true, name: true, parentId: true },
        });
        frontier = children.map((child) => child.id);
        children.forEach((child) => subtree.set(child.id, child));
      }
      const folderIds = [...subtree.keys()];

      const files = await prisma.file.findMany({
        where: { ownerId: userId, folderId: { in: folderIds } },
        include: { chunks: { select: { telegramMessageId: true } } },
      });

      // Metadata first (DB cascade removes descendants, files, chunks,
      // sessions), then storage-side cleanup through the queue.
      await prisma.folder.delete({ where: { id: folderId } });

      const messageIds = files
        .flatMap((file) => file.chunks.map((chunk) => chunk.telegramMessageId))
        .filter((id): id is string => Boolean(id));
      for (let start = 0; start < messageIds.length; start += DELETE_BATCH_SIZE) {
        await queue.enqueue('messages-delete', {
          userId,
          messageIds: messageIds.slice(start, start + DELETE_BATCH_SIZE),
        });
      }
      await Promise.all(
        files.map((file) => rm(path.join(stagingDir, file.id), { recursive: true, force: true })),
      );

      // The activity log shows WHAT was deleted: the folder's name plus a
      // nested (capped) tree of everything inside it.
      const { tree, truncated } = buildDeletedTree(
        folderId,
        subtree,
        files.map((file) => ({ name: file.name, folderId: file.folderId })),
      );
      await audit.record(userId, AuditEventTypes.FOLDER_DELETED, {
        folderId,
        name: root.name,
        folders: folderIds.length,
        files: files.length,
        tree,
        ...(truncated ? { truncated: true } : {}),
      });
    },

    /**
     * Delete a folder only when its whole subtree holds zero files. Used by
     * upload-cancel cleanup: it removes the empty folder skeleton the upload
     * created, and can never take real user data with it.
     */
    async deleteFolderIfEmpty(userId: string, folderId: string): Promise<boolean> {
      const folder = await prisma.folder.findUnique({ where: { id: folderId } });
      if (!folder || folder.ownerId !== userId) {
        return false; // already gone — that's the goal state
      }
      const { fileCount } = await subtreeSize(userId, folderId);
      if (fileCount > 0) {
        return false;
      }
      await prisma.folder.delete({ where: { id: folderId } });
      return true;
    },

    async listDrive(userId: string, folderId: string | null): Promise<DriveListing> {
      const breadcrumb: { id: string; name: string }[] = [];
      let currentName = '';
      if (folderId) {
        let current: Folder | null = await requireFolder(userId, folderId);
        currentName = current.name;
        for (let depth = 0; current && depth < 200; depth += 1) {
          breadcrumb.unshift({ id: current.id, name: current.name });
          current = current.parentId
            ? await prisma.folder.findUnique({ where: { id: current.parentId } })
            : null;
        }
      }

      const [folders, files, currentFolder] = await Promise.all([
        prisma.folder.findMany({
          where: { ownerId: userId, parentId: folderId },
          orderBy: { name: 'asc' },
        }),
        prisma.file.findMany({
          where: { ownerId: userId, folderId },
          orderBy: { name: 'asc' },
          include: { chunks: { select: { size: true, status: true, progress: true } } },
        }),
        folderId
          ? subtreeSize(userId, folderId).then((agg) => ({
              id: folderId,
              name: currentName,
              ...agg,
            }))
          : Promise.resolve(null),
      ]);

      return {
        breadcrumb,
        currentFolder,
        folders: folders.map(toFolderDto),
        files: files.map((file) => toFileDto(file, file.chunks)),
      };
    },
  };

  /** Recursive total size + file count for a folder and all its descendants. */
  async function subtreeSize(
    userId: string,
    rootId: string,
  ): Promise<{ totalBytes: number; fileCount: number }> {
    const folderIds = [rootId];
    let frontier = [rootId];
    while (frontier.length > 0) {
      const children = await prisma.folder.findMany({
        where: { ownerId: userId, parentId: { in: frontier } },
        select: { id: true },
      });
      frontier = children.map((child) => child.id);
      folderIds.push(...frontier);
    }
    const aggregate = await prisma.file.aggregate({
      where: { ownerId: userId, folderId: { in: folderIds } },
      _count: true,
      _sum: { size: true },
    });
    return {
      totalBytes: Number(aggregate._sum.size ?? 0n),
      fileCount: aggregate._count,
    };
  }
}

export type FoldersService = ReturnType<typeof createFoldersService>;

export interface DeletedTreeNode {
  name: string;
  folders: DeletedTreeNode[];
  files: string[];
}

/** Audit metadata must stay bounded — a node_modules-sized delete would blow
 *  up the row otherwise. Enough to answer "what exactly was in there?". */
const DELETED_TREE_MAX_ENTRIES = 200;

export function buildDeletedTree(
  rootId: string,
  folders: Map<string, { id: string; name: string; parentId: string | null }>,
  files: { name: string; folderId: string | null }[],
): { tree: DeletedTreeNode; truncated: boolean } {
  let budget = DELETED_TREE_MAX_ENTRIES;
  let truncated = false;

  const childrenOf = new Map<string, string[]>();
  for (const folder of folders.values()) {
    if (folder.id === rootId || !folder.parentId) {
      continue;
    }
    const list = childrenOf.get(folder.parentId) ?? [];
    list.push(folder.id);
    childrenOf.set(folder.parentId, list);
  }
  const filesOf = new Map<string, string[]>();
  for (const file of files) {
    if (!file.folderId) {
      continue;
    }
    const list = filesOf.get(file.folderId) ?? [];
    list.push(file.name);
    filesOf.set(file.folderId, list);
  }

  function build(id: string): DeletedTreeNode {
    const node: DeletedTreeNode = { name: folders.get(id)?.name ?? '', folders: [], files: [] };
    for (const fileName of filesOf.get(id) ?? []) {
      if (budget <= 0) {
        truncated = true;
        break;
      }
      budget -= 1;
      node.files.push(fileName);
    }
    for (const childId of childrenOf.get(id) ?? []) {
      if (budget <= 0) {
        truncated = true;
        break;
      }
      budget -= 1;
      node.folders.push(build(childId));
    }
    return node;
  }

  return { tree: build(rootId), truncated };
}

function toFolderDto(folder: Folder): FolderDto {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    createdAt: folder.createdAt.toISOString(),
  };
}
