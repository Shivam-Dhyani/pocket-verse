import type {
  CreateFolderInput,
  DriveListing,
  FileDto,
  FolderDto,
  SearchResultDto,
  UpdateFileInput,
  UpdateFolderInput,
} from '@pocketverse/shared';
import { API_URL, request } from '@/lib/api';

export const driveApi = {
  list: (folderId: string | null) =>
    request<DriveListing>(
      `/api/drive${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`,
      {
        auth: true,
      },
    ),
  search: (query: string) =>
    request<{ results: SearchResultDto[] }>(`/api/files/search?q=${encodeURIComponent(query)}`, {
      auth: true,
    }),
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
 * A short-lived tokenized URL for a file — used for previews (inline) and
 * native-manager downloads (attachment). The token authorizes a plain
 * navigation, so no header is needed.
 */
export async function fileUrl(
  fileId: string,
  disposition: 'inline' | 'attachment',
): Promise<string> {
  const { token } = await request<{ token: string }>(`/api/files/${fileId}/download-token`, {
    method: 'POST',
    auth: true,
  });
  return `${API_URL}/api/files/${fileId}/download?token=${encodeURIComponent(token)}&disposition=${disposition}`;
}

/**
 * Downloads through the browser's native download manager: mint a short-lived
 * token, then navigate. The browser shows real progress/speed/cancel, and
 * multi-GB files never pass through page memory.
 */
export async function downloadFile(file: FileDto): Promise<void> {
  const anchor = document.createElement('a');
  anchor.href = await fileUrl(file.id, 'attachment');
  anchor.download = file.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/** Whether a file type can be previewed inline in the browser. */
export function canPreview(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType === 'application/pdf';
}
