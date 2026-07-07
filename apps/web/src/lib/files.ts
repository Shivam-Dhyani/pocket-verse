import type {
  CreateFolderInput,
  DriveListing,
  FileDto,
  FolderDto,
  UpdateFileInput,
  UpdateFolderInput,
  UploadSessionDto,
} from '@pocketverse/shared';
import { API_URL, ApiError, apiFetch, request } from '@/lib/api';

export const driveApi = {
  list: (folderId: string | null) =>
    request<DriveListing>(
      `/api/drive${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`,
      {
        auth: true,
      },
    ),
  createFolder: (input: CreateFolderInput) =>
    request<{ folder: FolderDto }>('/api/folders', { method: 'POST', body: input, auth: true }),
  updateFolder: (id: string, input: UpdateFolderInput) =>
    request<{ folder: FolderDto }>(`/api/folders/${id}`, {
      method: 'PATCH',
      body: input,
      auth: true,
    }),
  deleteFolder: (id: string) =>
    request<void>(`/api/folders/${id}`, { method: 'DELETE', auth: true }),
  updateFile: (id: string, input: UpdateFileInput) =>
    request<{ file: FileDto }>(`/api/files/${id}`, { method: 'PATCH', body: input, auth: true }),
  deleteFile: (id: string) => request<void>(`/api/files/${id}`, { method: 'DELETE', auth: true }),
};

/**
 * Resumable part-by-part upload with REAL progress: each tick is a part the
 * server has acknowledged and staged — never an estimate.
 */
export async function uploadFileInParts(
  file: File,
  folderId: string | null,
  onProgress: (fraction: number) => void,
): Promise<void> {
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

  let part = upload.nextPart;
  while (part < upload.totalParts) {
    const slice = file.slice(part * upload.partSize, (part + 1) * upload.partSize);
    const res = await apiFetch(`/api/files/uploads/${upload.uploadId}/parts/${part}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: slice,
    });

    if (res.ok) {
      part += 1;
      onProgress(part / upload.totalParts);
      continue;
    }

    const payload = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string; nextPart?: number };
    } | null;
    // The server tells us exactly where to resume from (restart, lost staging…).
    if (res.status === 409 && typeof payload?.error?.nextPart === 'number') {
      part = payload.error.nextPart;
      continue;
    }
    throw new ApiError(
      res.status,
      payload?.error?.code ?? 'UPLOAD_FAILED',
      payload?.error?.message ?? 'The upload failed. Your progress is saved — try again.',
    );
  }
}

/**
 * Downloads through the browser's native download manager: mint a short-lived
 * token, then navigate. The browser shows real progress/speed/cancel, and
 * multi-GB files never pass through page memory.
 */
export async function downloadFile(file: FileDto): Promise<void> {
  const { token } = await request<{ token: string }>(`/api/files/${file.id}/download-token`, {
    method: 'POST',
    auth: true,
  });
  const anchor = document.createElement('a');
  anchor.href = `${API_URL}/api/files/${file.id}/download?token=${encodeURIComponent(token)}`;
  anchor.download = file.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
