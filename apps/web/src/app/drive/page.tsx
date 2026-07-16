'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { FileDto, FolderDto } from '@pocketverse/shared';
import { track } from '@/lib/analytics';
import { api, ApiError } from '@/lib/api';
import { connectionApi } from '@/lib/connection';
import { downloadFile, downloadZip, driveApi, relativePathOf } from '@/lib/files';
import {
  UPLOAD_MAX_FILE_COUNT,
  UPLOAD_SUGGESTED_BATCH,
  UPLOAD_WARN_FILE_COUNT,
} from '@/lib/limits';
import {
  activeUploadFileIds,
  recordCreatedFolders,
  registerUploads,
  runUploads,
  useUploadsStore,
} from '@/stores/uploads';
import { useAuthStore } from '@/stores/auth';
import { AppHeader } from '@/components/app-header';
import { SearchBox } from '@/components/search-box';
import { UploadPanel } from '@/components/upload-panel';
import { PreviewModal } from '@/components/preview-modal';
import { MoveDialog } from '@/components/move-dialog';
import { useDialogs } from '@/components/dialogs';
import { EmptyState, StatusBadge, formatSize } from '@/components/ui';
import {
  DownloadIcon,
  FolderIcon,
  GridIcon,
  iconForMime,
  ListIcon,
  MoveIcon,
  PencilIcon,
  TrashIcon,
  UploadPortal,
  XIcon,
} from '@/components/icons';

export default function DrivePage() {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense fallback={null}>
      <DriveInner />
    </Suspense>
  );
}

function DriveInner() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const dialogs = useDialogs();
  // The current folder lives in the URL (?folder=<id>), not component state:
  // Back walks up exactly the path you navigated, refresh keeps your place,
  // and locations are bookmarkable — the way a drive should behave.
  const searchParams = useSearchParams();
  const folderId = searchParams.get('folder');
  const openFolder = useCallback(
    (id: string | null) => {
      router.push(id ? `/drive?folder=${encodeURIComponent(id)}` : '/drive');
    },
    [router],
  );
  const [error, setError] = useState<string | null>(null);
  // Label of the user action currently in flight ("Deleting…") — drives the
  // floating busy pill so no action ever runs without visible feedback.
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [preview, setPreview] = useState<FileDto | null>(null);
  const [moving, setMoving] = useState<FileDto | null>(null);
  const uploads = useUploadsStore((state) => state.uploads);
  const uploadCount = Object.keys(uploads).length;
  // Files still shown in the upload panel are hidden from the grid so the same
  // file never appears twice with two different progress indicators.
  const hiddenFileIds = activeUploadFileIds(uploads);

  useEffect(() => {
    const stored = window.localStorage.getItem('pv-view');
    if (stored === 'grid' || stored === 'list') {
      setView(stored);
    }
  }, []);
  const changeView = (next: 'list' | 'grid') => {
    setView(next);
    window.localStorage.setItem('pv-view', next);
  };

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
    refetchInterval: 30_000,
  });
  const connected = connection.data?.connection.status === 'connected';
  // e.g. the user ended Pocketverse's session from inside Telegram: the drive
  // listing still works (it's our metadata), but syncing is broken until they
  // reconnect — show the drive with an explanatory banner, not a dead end.
  const broken = connection.data?.connection.status === 'error';

  const drive = useQuery({
    queryKey: ['drive', folderId],
    queryFn: () => driveApi.list(folderId),
    enabled: me.isSuccess && (connected || broken),
    refetchInterval: (query) =>
      query.state.data?.files.some((file) => file.status === 'uploading') || uploadCount > 0
        ? 2500
        : false,
  });

  useEffect(() => {
    if (me.isError) {
      router.replace('/login');
    }
  }, [me.isError, router]);

  // Every drive history entry (root and each folder) carries a pvGuard stamp,
  // so the Back handler can tell "moving between folders" (normal, allowed)
  // from "about to fall out of the app".
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, pvGuard: true }, '');
  }, [folderId]);

  // Once signed in, the drive is the app's floor — pressing Back at the root
  // would only fall out of the app (users expect mobile-app behavior here).
  // The entry where the user ENTERED the drive is marked pvBase with a
  // sentinel pushed above it: Back through folders walks history normally;
  // Back landing on the base re-arms and asks first — with a stronger warning
  // while an upload is running. Header navigation is unaffected.
  useEffect(() => {
    if (!(connected || broken)) {
      return;
    }
    window.history.replaceState({ ...window.history.state, pvGuard: true, pvBase: true }, '');
    window.history.pushState({ ...window.history.state, pvBase: false }, '');

    const onPop = (event: PopStateEvent) => {
      const state = event.state as { pvGuard?: boolean; pvBase?: boolean } | null;
      if (!state?.pvBase) {
        return; // folder-to-folder or forward-page back-nav — let it happen
      }
      // We're on the floor: push a fresh sentinel so the page stays put, ask.
      window.history.pushState({ ...window.history.state, pvBase: false }, '');
      const uploading = Object.values(useUploadsStore.getState().uploads).some(
        (entry) => entry.state === 'uploading' || entry.state === 'paused',
      );
      void dialogs
        .confirm({
          title: uploading ? 'An upload is still running' : 'Leave your drive?',
          message: uploading
            ? 'Going back now will stop the upload that is in progress. We recommend staying until it finishes.'
            : 'Going back will take you out of Pocketverse. Are you sure?',
          confirmLabel: 'Leave',
          cancelLabel: uploading ? 'Stay and finish' : 'Stay',
          danger: uploading,
        })
        .then((ok) => {
          if (ok) {
            window.removeEventListener('popstate', onPop);
            window.history.go(-2); // past the sentinel and the base — out
          }
        });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // `dialogs` is stable (memoized provider API) — deps limited to the gates.
  }, [connected, broken, dialogs]);

  // Refreshing the drive also refreshes the header storage total so the size
  // chip updates without a page reload.
  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['drive'] }),
      queryClient.invalidateQueries({ queryKey: ['stats'] }),
    ]);
  }, [queryClient]);
  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');

  // Uploads files while recreating any folder structure they carry (dropped
  // folders via react-dropzone `path`, or the folder picker's
  // webkitRelativePath). Each unique directory is resolved to a real folder id
  // exactly once, so the tree lands nested — just like copying it on your device.
  const ingest = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      // Too many files to land reliably in one go — guide the user to smaller
      // batches instead of dead-ending them or letting a doomed upload stall.
      if (files.length > UPLOAD_MAX_FILE_COUNT) {
        await dialogs.notice({
          title: "Let's add this one in smaller batches",
          message: (
            <>
              <p style={{ margin: '0 0 var(--pv-s3)' }}>
                This folder has {files.length.toLocaleString()} files — that's more than we can add
                reliably all at once, and trying could make it stall partway through.
              </p>
              <p style={{ margin: '0 0 var(--pv-s3)' }}>
                Here's the easy way to get everything in safely: add it a little at a time. Open the
                folder and drag in a portion — say, a few sub-folders or around{' '}
                {UPLOAD_SUGGESTED_BATCH.toLocaleString()} files — then come back for the rest.
                Everything lands in the same place, organised just the way it is now.
              </p>
              <p style={{ margin: 0 }}>
                We're making big uploads smoother in a future update. For now, a few smaller batches
                are the reliable way in.
              </p>
            </>
          ),
          confirmLabel: 'Got it',
        });
        return;
      }

      // Large but doable — set expectations, then let them proceed.
      if (files.length > UPLOAD_WARN_FILE_COUNT) {
        const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
        const ok = await dialogs.confirm({
          title: 'This is a big upload',
          message: (
            <>
              <p style={{ margin: '0 0 var(--pv-s3)' }}>
                This folder has {files.length.toLocaleString()} files ({formatSize(totalBytes)}).
                It'll upload in the background — you can keep using Pocketverse while it works, but
                it might take a while to finish. If you'd rather not wait on one long upload, you
                can also add it in smaller batches, a portion at a time.
              </p>
              <p style={{ margin: 0 }}>
                One thing to remember: <strong>keep this tab open until it's done</strong> — closing
                or refreshing the page stops uploads that are still on their way.
              </p>
            </>
          ),
          confirmLabel: 'Start upload',
          cancelLabel: 'Not now',
        });
        if (!ok) {
          return;
        }
      }

      setError(null);
      track('upload_started', {
        files: files.length,
        is_folder: relativePathOf(files[0]!).dirs.length > 0,
      });
      // One batch per top-level folder in this drop, so a whole folder shows as
      // a single item in the upload panel (not one row per file inside it).
      const nonce = Date.now().toString(36);
      const batches = new Map<string, { id: string; label: string }>();

      const prepared = files.map((file) => {
        const { dirs } = relativePathOf(file);
        let batch: { id: string; label: string } | undefined;
        if (dirs.length > 0) {
          const top = dirs[0]!;
          batch = batches.get(top);
          if (!batch) {
            batch = { id: `${nonce}:${top}`, label: top };
            batches.set(top, batch);
          }
        }
        return { file, dirs, batch };
      });

      // Register every entry in ONE store update. This makes the folder appear
      // immediately, gives the batch a stable progress denominator (all sizes
      // known up-front, so the percentage only climbs), and — critically —
      // avoids copying the whole uploads map once per file, which froze the tab
      // on a large tree like a React project's node_modules.
      const ids = registerUploads(prepared.map(({ file, batch }) => ({ file, batch })));

      // Resolve a directory to a real folder id, creating one segment at a time
      // and caching each path prefix as a promise. Concurrent siblings share the
      // parent's promise, so shared ancestors are never created twice — the
      // ensure-path call is find-then-create (not atomic), so this is what keeps
      // it race-free even though uploads run concurrently. Folders the upload
      // CREATES are recorded per batch so cancelling can remove them again.
      const dirCache = new Map<string, Promise<string | null>>();
      dirCache.set('', Promise.resolve(folderId));
      const ensureDir = (dirs: string[]): Promise<string | null> => {
        const key = dirs.join('/');
        let promise = dirCache.get(key);
        if (!promise) {
          const segment = dirs[dirs.length - 1]!;
          const batch = batches.get(dirs[0]!);
          promise = ensureDir(dirs.slice(0, -1)).then((parentId) =>
            driveApi.ensureFolderPath(parentId, [segment]).then((result) => {
              if (batch) {
                recordCreatedFolders(batch.id, result.createdIds);
              }
              return result.folderId;
            }),
          );
          dirCache.set(key, promise);
        }
        return promise;
      };

      // Upload through a bounded pool: directory creation is resolved lazily
      // inside it, so we stay well under rate/flood limits and never block every
      // upload behind a long serial folder-creation pass.
      runUploads(
        prepared.map(({ file, dirs }, index) => ({
          id: ids[index]!,
          file,
          resolveFolderId: () => ensureDir(dirs),
        })),
        refresh,
      );
    },
    [folderId, refresh, dialogs],
  );

  // Multi-select: any mix of files and folders, acted on together.
  const [selFiles, setSelFiles] = useState<ReadonlySet<string>>(new Set());
  const [selFolders, setSelFolders] = useState<ReadonlySet<string>>(new Set());
  const selectionCount = selFiles.size + selFolders.size;
  const clearSelection = useCallback(() => {
    setSelFiles(new Set());
    setSelFolders(new Set());
  }, []);
  useEffect(() => clearSelection(), [folderId, clearSelection]);
  const toggleIn = (set: ReadonlySet<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  };
  const toggleFile = (id: string) => setSelFiles((prev) => toggleIn(prev, id));
  const toggleFolder = (id: string) => setSelFolders((prev) => toggleIn(prev, id));

  async function deleteSelected() {
    const ok = await dialogs.confirm({
      title: `Delete ${selectionCount} ${selectionCount === 1 ? 'item' : 'items'}?`,
      message:
        'Everything selected — including folder contents — is deleted from Pocketverse and from your Telegram storage.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) {
      return;
    }
    setError(null);
    setBusy(`Deleting ${selectionCount} ${selectionCount === 1 ? 'item' : 'items'}…`);
    try {
      for (const id of selFiles) {
        await driveApi.deleteFile(id);
      }
      for (const id of selFolders) {
        await driveApi.deleteFolder(id);
      }
      clearSelection();
      await refresh();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  }

  async function downloadSelected(fileIds: string[], folderIds: string[]) {
    setError(null);
    setBusy('Preparing your download…');
    try {
      await downloadZip(fileIds, folderIds);
      clearSelection();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  }

  const onDrop = useCallback((accepted: File[]) => void ingest(accepted), [ingest]);
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    disabled: !connected,
  });
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadMenu, setUploadMenu] = useState(false);

  async function act(label: string, action: () => Promise<unknown>) {
    setError(null);
    setBusy(label);
    try {
      await action();
      await refresh();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  }

  // Clicking a file opens it: previewable types render; others get a calm
  // "open on your device" hand-off (handled inside the modal).
  function openFile(file: FileDto) {
    if (file.status === 'ready') {
      setPreview(file);
      track('file_previewed'); // no name/id — just the count
    }
  }

  // Files whose sync to Telegram failed — retryable once the connection is
  // healthy, because the server keeps their staged bytes for exactly this.
  const failedCount = (drive.data?.files ?? []).filter((file) => file.status === 'error').length;
  async function retryFailedSyncs() {
    setError(null);
    setBusy('Retrying sync…');
    try {
      track('retry_sync_clicked', { failed: failedCount });
      const { retried, unrecoverable } = await driveApi.retryFailed();
      await refresh();
      if (unrecoverable > 0) {
        await dialogs.notice({
          title: retried > 0 ? 'Some files are syncing again' : 'These files need a fresh upload',
          message: `${retried > 0 ? `${retried} ${retried === 1 ? 'file is' : 'files are'} on their way again. ` : ''}${unrecoverable} ${unrecoverable === 1 ? 'file' : 'files'} couldn't be retried — their data is no longer on our server (we don't keep your bytes), so please upload ${unrecoverable === 1 ? 'it' : 'them'} again from your device.`,
        });
      }
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  }

  // All destructive/naming actions use in-app dialogs (no browser alert/prompt).
  async function newFolder() {
    const name = await dialogs.prompt({
      title: 'New folder',
      label: 'Folder name',
      placeholder: 'e.g. Photos',
      confirmLabel: 'Create',
    });
    if (name) {
      await act('Creating folder…', () => driveApi.createFolder({ name, parentId: folderId }));
    }
  }

  async function renameFile(file: FileDto) {
    const name = await dialogs.prompt({
      title: 'Rename file',
      label: 'New name',
      initial: file.name,
    });
    if (name && name !== file.name) {
      await act('Renaming…', () => driveApi.updateFile(file.id, { name }));
    }
  }

  async function deleteFile(file: FileDto) {
    const ok = await dialogs.confirm({
      title: 'Delete file',
      message: `Delete “${file.name}”? This also deletes it from your connected storage.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) {
      await act(`Deleting “${file.name}”…`, () => driveApi.deleteFile(file.id));
    }
  }

  async function renameFolder(folder: FolderDto) {
    const name = await dialogs.prompt({
      title: 'Rename folder',
      label: 'New name',
      initial: folder.name,
    });
    if (name && name !== folder.name) {
      await act('Renaming…', () => driveApi.updateFolder(folder.id, { name }));
    }
  }

  async function deleteFolder(folder: FolderDto) {
    const ok = await dialogs.confirm({
      title: 'Delete folder',
      message: `Delete “${folder.name}” and everything inside it? Files are also deleted from your connected storage.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) {
      await act(`Deleting “${folder.name}”…`, () => driveApi.deleteFolder(folder.id));
    }
  }

  const visibleFiles = (drive.data?.files ?? []).filter((file) => !hiddenFileIds.has(file.id));
  const visibleFolders = drive.data?.folders ?? [];
  const isEmpty = drive.data && visibleFolders.length === 0 && visibleFiles.length === 0;

  if (me.isPending || (me.isSuccess && connection.isPending)) {
    return (
      <div className="pv-app">
        <p className="pv-footnote" style={{ marginTop: '20vh' }}>
          <span className="pv-spinner" /> Opening your universe…
        </p>
      </div>
    );
  }
  if (me.isError) {
    return null;
  }

  return (
    <div className="pv-app">
      <AppHeader>{connected && <SearchBox onOpen={(file) => setPreview(file)} />}</AppHeader>

      {!connected && !broken ? (
        <div className="pv-card" style={{ textAlign: 'center', marginTop: 'var(--pv-s6)' }}>
          <UploadPortal width={40} height={40} style={{ color: 'var(--pv-accent)' }} />
          <h1 style={{ marginTop: 'var(--pv-s3)' }}>Connect your storage</h1>
          <p className="pv-sub">Give your files a home in storage you control.</p>
          <Link href="/connect">
            <button className="pv-button" type="button">
              Connect storage
            </button>
          </Link>
        </div>
      ) : (
        <div {...getRootProps({ className: `pv-dropzone${isDragActive ? ' active' : ''}` })}>
          {broken && (
            <div className="pv-banner" role="alert">
              <div>
                <strong>Pocketverse lost access to your Telegram account.</strong>{' '}
                {connection.data?.connection.lastError ??
                  'The connection stopped responding — this usually means the session was ended from inside Telegram.'}{' '}
                Your files are safe; uploads, downloads, and syncing are paused until you reconnect.
              </div>
              <Link href="/connect">
                <button className="pv-button" type="button">
                  Reconnect
                </button>
              </Link>
            </div>
          )}
          <input {...getInputProps()} />

          {isDragActive && (
            <div className="pv-drop-overlay">
              <UploadPortal width={22} height={22} /> Drop files to upload here
            </div>
          )}

          <div className="pv-drive-toolbar">
            <Breadcrumb breadcrumb={drive.data?.breadcrumb ?? []} onNavigate={openFolder} />
            <div className="pv-menu-wrap">
              <button
                className="pv-button"
                type="button"
                disabled={broken}
                title={broken ? 'Reconnect your Telegram account to upload' : undefined}
                onClick={() => setUploadMenu((open2) => !open2)}
              >
                <UploadPortal width={16} height={16} /> Upload
              </button>
              {uploadMenu && (
                <>
                  <div className="pv-menu-backdrop" onClick={() => setUploadMenu(false)} />
                  <div className="pv-menu" role="menu">
                    <button
                      type="button"
                      onClick={() => {
                        setUploadMenu(false);
                        open();
                      }}
                    >
                      <UploadPortal width={16} height={16} /> Upload files
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUploadMenu(false);
                        folderInputRef.current?.click();
                      }}
                    >
                      <FolderIcon width={16} height={16} /> Upload folder
                    </button>
                  </div>
                </>
              )}
            </div>
            <input
              ref={(el) => {
                if (el) {
                  // Directory-picker attributes aren't in the React input types.
                  el.setAttribute('webkitdirectory', '');
                  el.setAttribute('directory', '');
                }
                folderInputRef.current = el;
              }}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) {
                  void ingest(Array.from(event.target.files));
                }
                event.target.value = '';
              }}
            />
            <button
              className="pv-button pv-button--ghost"
              type="button"
              disabled={broken}
              onClick={() => void newFolder()}
            >
              <FolderIcon width={16} height={16} /> New folder
            </button>
            <span style={{ display: 'flex', gap: 2 }}>
              <button
                className="pv-iconbtn"
                type="button"
                aria-label="List view"
                onClick={() => changeView('list')}
                style={view === 'list' ? { color: 'var(--pv-accent)' } : undefined}
              >
                <ListIcon />
              </button>
              <button
                className="pv-iconbtn"
                type="button"
                aria-label="Grid view"
                onClick={() => changeView('grid')}
                style={view === 'grid' ? { color: 'var(--pv-accent)' } : undefined}
              >
                <GridIcon />
              </button>
            </span>
          </div>

          {selectionCount > 0 && (
            <div className="pv-selectbar" role="toolbar" aria-label="Selection actions">
              <span className="pv-selectbar-count">{selectionCount} selected</span>
              <button
                className="pv-button pv-button--ghost"
                type="button"
                disabled={busy !== null}
                onClick={() => void downloadSelected([...selFiles], [...selFolders])}
              >
                <DownloadIcon width={15} height={15} /> Download
              </button>
              <button
                className="pv-button pv-button--ghost"
                type="button"
                disabled={busy !== null}
                onClick={() => void deleteSelected()}
              >
                <TrashIcon width={15} height={15} /> Delete
              </button>
              <button
                className="pv-iconbtn"
                type="button"
                title="Clear selection"
                aria-label="Clear selection"
                onClick={clearSelection}
              >
                <XIcon width={15} height={15} />
              </button>
            </div>
          )}

          {drive.data?.currentFolder && (
            <div className="pv-folder-meta">
              <FolderIcon width={14} height={14} />
              {drive.data.currentFolder.name} — {formatSize(drive.data.currentFolder.totalBytes)} ·{' '}
              {drive.data.currentFolder.fileCount}{' '}
              {drive.data.currentFolder.fileCount === 1 ? 'file' : 'files'}
            </div>
          )}

          {connected && failedCount > 0 && (
            <div className="pv-banner pv-banner--warn">
              <div>
                {failedCount} {failedCount === 1 ? 'file' : 'files'} couldn’t finish syncing to
                Telegram. Now that your connection is healthy, you can send{' '}
                {failedCount === 1 ? 'it' : 'them'} again.
              </div>
              <button
                className="pv-button"
                type="button"
                disabled={busy !== null}
                onClick={() => void retryFailedSyncs()}
              >
                Retry sync
              </button>
            </div>
          )}

          {error && (
            <div className="pv-error" role="alert">
              {error}
            </div>
          )}

          <UploadPanel onSettled={refresh} />

          {drive.isPending ? (
            <p className="pv-footnote" style={{ padding: 'var(--pv-s6)' }}>
              <span className="pv-spinner" /> Loading…
            </p>
          ) : isEmpty ? (
            <EmptyState icon={<UploadPortal width={44} height={44} />} title="Nothing here yet">
              Drag files anywhere in this area, or use the Upload button.
            </EmptyState>
          ) : (
            (() => {
              const viewProps: ViewProps = {
                folders: visibleFolders,
                files: visibleFiles,
                selectedFiles: selFiles,
                selectedFolders: selFolders,
                onToggleFile: toggleFile,
                onToggleFolder: toggleFolder,
                onOpenFolder: openFolder,
                onOpenFile: openFile,
                onMove: setMoving,
                onRenameFile: renameFile,
                onDeleteFile: deleteFile,
                onRenameFolder: renameFolder,
                onDeleteFolder: deleteFolder,
                onDownloadFolder: (folder) => void downloadSelected([], [folder.id]),
              };
              return view === 'grid' ? <GridView {...viewProps} /> : <ListView {...viewProps} />;
            })()
          )}
        </div>
      )}

      {preview && <PreviewModal file={preview} onClose={() => setPreview(null)} />}
      {moving && <MoveDialog file={moving} onClose={() => setMoving(null)} onMoved={refresh} />}
      {busy && (
        <div className="pv-busy-pill" role="status" aria-live="polite">
          <span className="pv-spinner" /> {busy}
        </div>
      )}
    </div>
  );
}

function Breadcrumb({
  breadcrumb,
  onNavigate,
}: {
  breadcrumb: { id: string; name: string }[];
  onNavigate: (id: string | null) => void;
}) {
  return (
    <nav className="pv-breadcrumb">
      <button
        type="button"
        onClick={() => onNavigate(null)}
        className={breadcrumb.length === 0 ? 'current' : ''}
      >
        My universe
      </button>
      {breadcrumb.map((crumb, index) => (
        <span key={crumb.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
          <span style={{ opacity: 0.5 }}>/</span>
          <button
            type="button"
            onClick={() => onNavigate(crumb.id)}
            className={index === breadcrumb.length - 1 ? 'current' : ''}
          >
            {crumb.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

interface ViewProps {
  folders: FolderDto[];
  files: FileDto[];
  selectedFiles: ReadonlySet<string>;
  selectedFolders: ReadonlySet<string>;
  onToggleFile: (id: string) => void;
  onToggleFolder: (id: string) => void;
  onOpenFolder: (id: string) => void;
  onOpenFile: (file: FileDto) => void;
  onMove: (file: FileDto) => void;
  onRenameFile: (file: FileDto) => void;
  onDeleteFile: (file: FileDto) => void;
  onRenameFolder: (folder: FolderDto) => void;
  onDeleteFolder: (folder: FolderDto) => void;
  onDownloadFolder: (folder: FolderDto) => void;
}

/** Row/card checkbox — stops propagation so selecting never opens the item. */
function SelectBox({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <label className="pv-select-box" onClick={(event) => event.stopPropagation()}>
      <input type="checkbox" checked={checked} aria-label={label} onChange={onToggle} />
    </label>
  );
}

function fileActions(file: FileDto, props: ViewProps) {
  return (
    // Clicks on the action buttons must not also trigger the row's open handler.
    <span className="pv-row-actions" onClick={(event) => event.stopPropagation()}>
      {file.status === 'ready' && (
        <button
          className="pv-iconbtn"
          type="button"
          title="Download"
          onClick={() => void downloadFile(file)}
        >
          <DownloadIcon width={16} height={16} />
        </button>
      )}
      <button
        className="pv-iconbtn"
        type="button"
        title="Rename"
        onClick={() => props.onRenameFile(file)}
      >
        <PencilIcon width={16} height={16} />
      </button>
      <button className="pv-iconbtn" type="button" title="Move" onClick={() => props.onMove(file)}>
        <MoveIcon width={16} height={16} />
      </button>
      <button
        className="pv-iconbtn"
        type="button"
        title="Delete"
        onClick={() => props.onDeleteFile(file)}
      >
        <TrashIcon width={16} height={16} />
      </button>
    </span>
  );
}

function folderActions(folder: FolderDto, props: ViewProps) {
  return (
    <span className="pv-row-actions" onClick={(event) => event.stopPropagation()}>
      <button
        className="pv-iconbtn"
        type="button"
        title="Download as zip"
        onClick={() => props.onDownloadFolder(folder)}
      >
        <DownloadIcon width={16} height={16} />
      </button>
      <button
        className="pv-iconbtn"
        type="button"
        title="Rename"
        onClick={() => props.onRenameFolder(folder)}
      >
        <PencilIcon width={16} height={16} />
      </button>
      <button
        className="pv-iconbtn"
        type="button"
        title="Delete"
        onClick={() => props.onDeleteFolder(folder)}
      >
        <TrashIcon width={16} height={16} />
      </button>
    </span>
  );
}

function ListView(props: ViewProps) {
  return (
    <ul className="pv-list">
      {props.folders.map((folder) => (
        <li
          key={folder.id}
          className={`pv-row pv-row--clickable${props.selectedFolders.has(folder.id) ? ' selected' : ''}`}
          onClick={() => props.onOpenFolder(folder.id)}
        >
          <SelectBox
            checked={props.selectedFolders.has(folder.id)}
            label={`Select ${folder.name}`}
            onToggle={() => props.onToggleFolder(folder.id)}
          />
          <span className="pv-row-icon">
            <FolderIcon />
          </span>
          <span className="pv-row-main">
            <span className="pv-row-name">{folder.name}</span>
            <span className="pv-row-meta">Folder</span>
          </span>
          {folderActions(folder, props)}
        </li>
      ))}
      {props.files.map((file) => {
        const Icon = iconForMime(file.mimeType);
        const clickable = file.status === 'ready';
        return (
          <li
            key={file.id}
            className={`pv-row${clickable ? ' pv-row--clickable' : ''}${props.selectedFiles.has(file.id) ? ' selected' : ''}`}
            onClick={clickable ? () => props.onOpenFile(file) : undefined}
          >
            <SelectBox
              checked={props.selectedFiles.has(file.id)}
              label={`Select ${file.name}`}
              onToggle={() => props.onToggleFile(file.id)}
            />
            <span className="pv-row-icon">
              <Icon />
            </span>
            <span className="pv-row-main">
              <span className="pv-row-name">{file.name}</span>
              <span
                className="pv-row-meta"
                style={{ display: 'flex', gap: 'var(--pv-s2)', alignItems: 'center' }}
              >
                {formatSize(file.size)}
                <StatusBadge status={file.status} syncProgress={file.syncProgress} />
              </span>
            </span>
            {fileActions(file, props)}
          </li>
        );
      })}
    </ul>
  );
}

function GridView(props: ViewProps) {
  return (
    <div className="pv-grid">
      {props.folders.map((folder) => (
        <div
          key={folder.id}
          className={`pv-grid-card pv-row--clickable${props.selectedFolders.has(folder.id) ? ' selected' : ''}`}
          onClick={() => props.onOpenFolder(folder.id)}
        >
          <SelectBox
            checked={props.selectedFolders.has(folder.id)}
            label={`Select ${folder.name}`}
            onToggle={() => props.onToggleFolder(folder.id)}
          />
          <span className="pv-row-icon">
            <FolderIcon width={26} height={26} />
          </span>
          <span className="pv-row-name" style={{ fontWeight: 500 }}>
            {folder.name}
          </span>
          {folderActions(folder, props)}
        </div>
      ))}
      {props.files.map((file) => {
        const Icon = iconForMime(file.mimeType);
        const clickable = file.status === 'ready';
        return (
          <div
            key={file.id}
            className={`pv-grid-card${clickable ? ' pv-row--clickable' : ''}${props.selectedFiles.has(file.id) ? ' selected' : ''}`}
            onClick={clickable ? () => props.onOpenFile(file) : undefined}
          >
            <SelectBox
              checked={props.selectedFiles.has(file.id)}
              label={`Select ${file.name}`}
              onToggle={() => props.onToggleFile(file.id)}
            />
            <span className="pv-row-icon">
              <Icon width={26} height={26} />
            </span>
            <span className="pv-row-name" style={{ fontWeight: 500 }}>
              {file.name}
            </span>
            <span className="pv-row-meta">{formatSize(file.size)}</span>
            <StatusBadge status={file.status} syncProgress={file.syncProgress} />
            {fileActions(file, props)}
          </div>
        );
      })}
    </div>
  );
}
