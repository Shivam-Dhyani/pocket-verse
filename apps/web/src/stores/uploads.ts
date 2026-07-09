import { create } from 'zustand';
import type { UploadSessionDto } from '@pocketverse/shared';
import { ApiError, apiFetch, request } from '@/lib/api';

export type UploadState = 'uploading' | 'paused' | 'error' | 'syncing';

export interface UploadEntry {
  id: string;
  name: string;
  fraction: number;
  state: UploadState;
  error?: string;
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
        [id]: { id, name: '', fraction: 0, state: 'uploading', ...state.uploads[id], ...patch },
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
): Promise<void> {
  const id = `u${++counter}`;
  const store = useUploadsStore.getState();
  store.set(id, { name: file.name, fraction: 0, state: 'uploading' });

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
  // user's storage — is still running. Don't claim "done": hand off to the
  // file row's honest "syncing X%" badge, which becomes the single indicator.
  store.set(id, { state: 'syncing', fraction: 1 });
  controllers.delete(id);
  onSettled();
  setTimeout(() => dismissUpload(id), 2500);
}
