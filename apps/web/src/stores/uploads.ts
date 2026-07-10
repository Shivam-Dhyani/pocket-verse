import { create } from 'zustand';
import type { UploadSessionDto } from '@pocketverse/shared';
import { ApiError, apiFetch, request } from '@/lib/api';

export type UploadState = 'uploading' | 'paused' | 'error' | 'syncing';

export interface UploadEntry {
  id: string;
  name: string;
  fraction: number;
  state: UploadState;
  /** Byte size — lets a folder batch show accurate weighted progress. */
  size: number;
  /** The server file id, once the upload session exists — lets the drive hide
   *  the file row while it's represented in the upload panel (no double status). */
  fileId?: string;
  /** When part of a folder upload, all its files share one batch shown as a
   *  single "folder" item in the panel instead of one row per file. */
  batchId?: string;
  batchLabel?: string;
  error?: string;
}

export interface UploadBatch {
  id: string;
  label: string;
}

interface UploadsStore {
  uploads: Record<string, UploadEntry>;
  set: (id: string, patch: Partial<UploadEntry>) => void;
  remove: (id: string) => void;
}

export const useUploadsStore = create<UploadsStore>((set) => ({
  uploads: {},
  set: (id, patch) =>
    set((state) => ({
      uploads: {
        ...state.uploads,
        [id]: {
          id,
          name: '',
          fraction: 0,
          state: 'uploading',
          size: 0,
          ...state.uploads[id],
          ...patch,
        },
      },
    })),
  remove: (id) =>
    set((state) => {
      const { [id]: _gone, ...rest } = state.uploads;
      return { uploads: rest };
    }),
}));

/**
 * Part-loop controllers. File handles can't live in the store (not
 * serializable) — they stay here, keyed by upload id, for pause/resume.
 */
interface Controller {
  file: File;
  session: UploadSessionDto;
  nextPart: number;
  paused: boolean;
}

const controllers = new Map<string, Controller>();
let counter = 0;

export async function startUpload(
  file: File,
  folderId: string | null,
  onSettled: () => void,
  batch?: UploadBatch,
): Promise<void> {
  const id = `u${++counter}`;
  const store = useUploadsStore.getState();
  store.set(id, {
    name: file.name,
    fraction: 0,
    state: 'uploading',
    size: file.size,
    batchId: batch?.id,
    batchLabel: batch?.label,
  });

  try {
    const { upload } = await request<{ upload: UploadSessionDto }>('/api/files/uploads', {
      method: 'POST',
      auth: true,
      body: {
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        folderId,
      },
    });
    controllers.set(id, { file, session: upload, nextPart: upload.nextPart, paused: false });
    useUploadsStore.getState().set(id, { fileId: upload.fileId });
    await runLoop(id, onSettled);
  } catch (error) {
    useUploadsStore.getState().set(id, {
      state: 'error',
      error: error instanceof ApiError ? error.message : 'Upload failed',
    });
    onSettled();
  }
}

export function pauseUpload(id: string): void {
  const ctrl = controllers.get(id);
  if (ctrl) {
    ctrl.paused = true;
  }
}

export async function resumeUpload(id: string, onSettled: () => void): Promise<void> {
  const ctrl = controllers.get(id);
  if (!ctrl) {
    return;
  }
  ctrl.paused = false;
  useUploadsStore.getState().set(id, { state: 'uploading', error: undefined });
  await runLoop(id, onSettled);
}

export function dismissUpload(id: string): void {
  controllers.delete(id);
  useUploadsStore.getState().remove(id);
}

async function runLoop(id: string, onSettled: () => void): Promise<void> {
  const ctrl = controllers.get(id);
  if (!ctrl) {
    return;
  }
  const store = useUploadsStore.getState();
  const { session } = ctrl;

  while (ctrl.nextPart < session.totalParts) {
    if (ctrl.paused) {
      store.set(id, { state: 'paused' });
      return; // resume() re-enters the loop from ctrl.nextPart
    }

    const slice = ctrl.file.slice(
      ctrl.nextPart * session.partSize,
      (ctrl.nextPart + 1) * session.partSize,
    );
    let res: Response;
    try {
      res = await apiFetch(`/api/files/uploads/${session.uploadId}/parts/${ctrl.nextPart}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: slice,
      });
    } catch (error) {
      store.set(id, {
        state: 'error',
        error: error instanceof ApiError ? error.message : 'Network error — resume to retry.',
      });
      onSettled();
      return;
    }

    if (res.ok) {
      ctrl.nextPart += 1;
      store.set(id, { fraction: ctrl.nextPart / session.totalParts });
      continue;
    }

    const payload = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string; nextPart?: number };
    } | null;
    // Server tells us where to resume from (restart, lost staging…).
    if (res.status === 409 && typeof payload?.error?.nextPart === 'number') {
      ctrl.nextPart = payload.error.nextPart;
      continue;
    }
    store.set(id, {
      state: 'error',
      error: payload?.error?.message ?? 'The upload failed. Resume to retry.',
    });
    onSettled();
    return;
  }

  // Bytes are now fully on our server, but the real work — syncing to the
  // user's storage — is still running. Show a brief "Uploaded ✓" beat, then
  // dismiss so the file row's honest "syncing X%" badge (which was hidden
  // while this entry was active) becomes the single indicator. No overlap.
  store.set(id, { state: 'syncing', fraction: 1 });
  controllers.delete(id);
  onSettled();
  setTimeout(() => dismissUpload(id), 1200);
}

/** File ids currently represented in the upload panel — hidden from the grid. */
export function activeUploadFileIds(uploads: Record<string, UploadEntry>): Set<string> {
  const ids = new Set<string>();
  for (const entry of Object.values(uploads)) {
    if (entry.fileId) {
      ids.add(entry.fileId);
    }
  }
  return ids;
}

export interface UploadGroup {
  key: string;
  kind: 'file' | 'folder';
  label: string;
  fraction: number;
  state: UploadState;
  totalCount: number;
  errorCount: number;
  entryIds: string[];
}

/**
 * Collapse raw upload entries into what the panel shows: loose files stay
 * individual; a folder upload becomes ONE item with weighted (by bytes)
 * aggregate progress and a combined state.
 */
export function toUploadGroups(uploads: Record<string, UploadEntry>): UploadGroup[] {
  const batches = new Map<string, UploadEntry[]>();
  const singles: UploadEntry[] = [];
  for (const entry of Object.values(uploads)) {
    if (entry.batchId) {
      const list = batches.get(entry.batchId) ?? [];
      list.push(entry);
      batches.set(entry.batchId, list);
    } else {
      singles.push(entry);
    }
  }

  const groups: UploadGroup[] = [];
  for (const entry of singles) {
    groups.push({
      key: entry.id,
      kind: 'file',
      label: entry.name,
      fraction: entry.fraction,
      state: entry.state,
      totalCount: 1,
      errorCount: entry.state === 'error' ? 1 : 0,
      entryIds: [entry.id],
    });
  }
  for (const [batchId, entries] of batches) {
    const totalSize = entries.reduce((sum, e) => sum + Math.max(1, e.size), 0);
    const sent = entries.reduce((sum, e) => sum + Math.max(1, e.size) * e.fraction, 0);
    groups.push({
      key: batchId,
      kind: 'folder',
      label: entries[0]?.batchLabel ?? 'Folder',
      fraction: totalSize ? sent / totalSize : 0,
      state: combineStates(entries.map((e) => e.state)),
      totalCount: entries.length,
      errorCount: entries.filter((e) => e.state === 'error').length,
      entryIds: entries.map((e) => e.id),
    });
  }
  return groups;
}

function combineStates(states: UploadState[]): UploadState {
  if (states.includes('uploading')) return 'uploading';
  if (states.includes('paused')) return 'paused';
  if (states.includes('error')) return 'error';
  if (states.includes('syncing')) return 'syncing';
  return 'syncing';
}

export function pauseGroup(entryIds: string[]): void {
  entryIds.forEach(pauseUpload);
}

export function resumeGroup(entryIds: string[], onSettled: () => void): void {
  entryIds.forEach((id) => void resumeUpload(id, onSettled));
}

export function dismissGroup(entryIds: string[]): void {
  entryIds.forEach(dismissUpload);
}
