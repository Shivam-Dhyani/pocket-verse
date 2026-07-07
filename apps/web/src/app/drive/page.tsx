'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { FileDto } from '@pocketverse/shared';
import { api, ApiError } from '@/lib/api';
import { connectionApi } from '@/lib/connection';
import { downloadFile, driveApi, uploadFileInParts } from '@/lib/files';
import { useAuthStore } from '@/stores/auth';

/**
 * Functional drive: folders, resumable uploads with real progress, streaming
 * downloads. The Phase 4 design pass restyles this; behavior lands now.
 */
export default function DrivePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, clearSession } = useAuthStore();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      if (!useAuthStore.getState().accessToken) {
        await api.refresh();
      }
      return api.me();
    },
    retry: false,
  });

  const connection = useQuery({
    queryKey: ['connection'],
    queryFn: connectionApi.status,
    retry: false,
    enabled: me.isSuccess,
  });

  const drive = useQuery({
    queryKey: ['drive', folderId],
    queryFn: () => driveApi.list(folderId),
    enabled: me.isSuccess && connection.data?.connection.status === 'connected',
    // While the engine is shipping chunks, keep the listing honest.
    refetchInterval: (query) =>
      query.state.data?.files.some((file) => file.status === 'uploading') ? 2000 : false,
  });

  useEffect(() => {
    if (me.isError) {
      router.replace('/login');
    }
  }, [me.isError, router]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['drive'] });
  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');

  const createFolder = useMutation({
    mutationFn: (name: string) => driveApi.createFolder({ name, parentId: folderId }),
    onSuccess: refresh,
    onError,
  });

  async function onPickFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    setError(null);
    for (const file of Array.from(files)) {
      const key = `${file.name}-${Date.now()}`;
      setUploads((current) => ({ ...current, [key]: 0 }));
      try {
        await uploadFileInParts(file, folderId, (fraction) =>
          setUploads((current) => ({ ...current, [key]: fraction })),
        );
      } catch (err) {
        onError(err);
      } finally {
        setUploads((current) => {
          const { [key]: _done, ...rest } = current;
          return rest;
        });
        await refresh();
      }
    }
  }

  async function act(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      onError(err);
    }
  }

  function fileActions(file: FileDto) {
    return (
      <span className="pv-row-actions">
        {file.status === 'ready' && (
          <button type="button" onClick={() => act(() => downloadFile(file))}>
            Download
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            const name = window.prompt('New name', file.name);
            if (name && name !== file.name) {
              void act(() => driveApi.updateFile(file.id, { name }));
            }
          }}
        >
          Rename
        </button>
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                `Delete "${file.name}"? This also deletes it from your connected storage.`,
              )
            ) {
              void act(() => driveApi.deleteFile(file.id));
            }
          }}
        >
          Delete
        </button>
      </span>
    );
  }

  if (me.isPending || connection.isPending) {
    return (
      <main className="pv-shell pv-shell--wide">
        <p className="pv-footnote">Opening your universe…</p>
      </main>
    );
  }
  if (me.isError) {
    return null;
  }

  const conn = connection.data?.connection;

  return (
    <main className="pv-shell pv-shell--wide">
      <header className="pv-drive-header">
        <span className="pv-brand">Pocketverse</span>
        <span>
          {user?.email ?? me.data?.user.email}{' '}
          <button
            className="pv-linklike"
            type="button"
            onClick={() =>
              void api
                .logout()
                .catch(() => undefined)
                .then(() => {
                  clearSession();
                  router.replace('/');
                })
            }
          >
            Sign out
          </button>
        </span>
      </header>

      {conn?.status !== 'connected' ? (
        <div className="pv-card">
          <h1>Your drive</h1>
          <span className="pv-badge">○ Storage not connected</span>
          <p className="pv-sub">Connect your own storage to give your files a home.</p>
          <Link href="/connect">
            <button className="pv-button" type="button">
              Connect storage
            </button>
          </Link>
        </div>
      ) : (
        <div className="pv-card">
          <nav className="pv-breadcrumb">
            <button className="pv-linklike" type="button" onClick={() => setFolderId(null)}>
              My universe
            </button>
            {drive.data?.breadcrumb.map((crumb) => (
              <span key={crumb.id}>
                {' / '}
                <button className="pv-linklike" type="button" onClick={() => setFolderId(crumb.id)}>
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>

          {error && (
            <div className="pv-error" role="alert">
              {error}
            </div>
          )}

          <div className="pv-toolbar">
            <button className="pv-button" type="button" onClick={() => fileInput.current?.click()}>
              Upload files
            </button>
            <button
              className="pv-button pv-button--ghost"
              type="button"
              onClick={() => {
                const name = window.prompt('Folder name');
                if (name) {
                  createFolder.mutate(name);
                }
              }}
            >
              New folder
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                void onPickFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </div>

          {Object.entries(uploads).map(([key, fraction]) => (
            <div className="pv-progress" key={key}>
              <span className="pv-progress-label">
                Uploading {key.replace(/-\d+$/, '')} — {Math.round(fraction * 100)}%
              </span>
              <span className="pv-progress-track">
                <span className="pv-progress-bar" style={{ width: `${fraction * 100}%` }} />
              </span>
            </div>
          ))}

          <ul className="pv-list">
            {drive.data?.folders.map((folder) => (
              <li key={folder.id} className="pv-row">
                <button
                  className="pv-linklike pv-row-name"
                  type="button"
                  onClick={() => setFolderId(folder.id)}
                >
                  📁 {folder.name}
                </button>
                <span className="pv-row-actions">
                  <button
                    type="button"
                    onClick={() => {
                      const name = window.prompt('New name', folder.name);
                      if (name && name !== folder.name) {
                        void act(() => driveApi.updateFolder(folder.id, { name }));
                      }
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete "${folder.name}" and everything inside it? Files are also deleted from your connected storage.`,
                        )
                      ) {
                        void act(() => driveApi.deleteFolder(folder.id));
                      }
                    }}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}

            {drive.data?.files.map((file) => (
              <li key={file.id} className="pv-row">
                <span className="pv-row-name">
                  📄 {file.name}
                  <span className="pv-row-meta">
                    {formatSize(file.size)}
                    {file.status === 'uploading' &&
                      ` · syncing to your storage… ${file.syncProgress ?? 0}%`}
                    {file.status === 'error' && ' · ⚠ upload failed'}
                    {file.status === 'ready' && ' · ✓ stored'}
                  </span>
                </span>
                {fileActions(file)}
              </li>
            ))}

            {drive.data && drive.data.folders.length === 0 && drive.data.files.length === 0 && (
              <li className="pv-footnote">Nothing here yet — upload your first file.</li>
            )}
          </ul>
        </div>
      )}
    </main>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    if (value < 1024) {
      break;
    }
    value /= 1024;
    unit = next;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}
