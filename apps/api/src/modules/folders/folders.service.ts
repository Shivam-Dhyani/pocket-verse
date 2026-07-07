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
      await requireFolder(userId, folderId);

      // Collect the whole subtree breadth-first.
      const folderIds = [folderId];
      let frontier = [folderId];
      while (frontier.length > 0) {
        const children = await prisma.folder.findMany({
          where: { ownerId: userId, parentId: { in: frontier } },
          select: { id: true },
        });
        frontier = children.map((child) => child.id);
        folderIds.push(...frontier);
      }

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

      await audit.record(userId, AuditEventTypes.FOLDER_DELETED, {
        folderId,
        folders: folderIds.length,
        files: files.length,
      });
    },

    async listDrive(userId: string, folderId: string | null): Promise<DriveListing> {
      const breadcrumb: { id: string; name: string }[] = [];
      if (folderId) {
        let current: Folder | null = await requireFolder(userId, folderId);
        for (let depth = 0; current && depth < 200; depth += 1) {
          breadcrumb.unshift({ id: current.id, name: current.name });
          current = current.parentId
            ? await prisma.folder.findUnique({ where: { id: current.parentId } })
            : null;
        }
      }

      const [folders, files] = await Promise.all([
        prisma.folder.findMany({
          where: { ownerId: userId, parentId: folderId },
          orderBy: { name: 'asc' },
        }),
        prisma.file.findMany({
          where: { ownerId: userId, folderId },
          orderBy: { name: 'asc' },
        }),
      ]);

      return {
        breadcrumb,
        folders: folders.map(toFolderDto),
        files: files.map(toFileDto),
      };
    },
  };
}

export type FoldersService = ReturnType<typeof createFoldersService>;

function toFolderDto(folder: Folder): FolderDto {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    createdAt: folder.createdAt.toISOString(),
  };
}
