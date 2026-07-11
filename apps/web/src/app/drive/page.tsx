'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { FileDto, FolderDto } from '@pocketverse/shared';
import { api, ApiError } from '@/lib/api';
import { connectionApi } from '@/lib/connection';
import { downloadFile, driveApi, relativePathOf } from '@/lib/files';
import {
  UPLOAD_MAX_FILE_COUNT,
  UPLOAD_SUGGESTED_BATCH,
  UPLOAD_WARN_FILE_COUNT,
} from '@/lib/limits';
import {
  activeUploadFileIds,
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
} from '@/components/icons';

export default function DrivePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const dialogs = useDialogs();
  const [folderId, setFolderId] = useState<string | null>(null);
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
  });
  const connected = connection.data?.connection.status === 'connected';

  const drive = useQuery({
    queryKey: ['drive', folderId],
    queryFn: () => driveApi.list(folderId),
    enabled: me.isSuccess && connected,
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
          message: `This folder has ${files.length.toLocaleString()} files (${formatSize(
            totalBytes,
          )}). It'll upload in the background and may take a while — you can keep using Pocketverse while it works. Ready to go?`,
          confirmLabel: 'Start upload',
          cancelLabel: 'Not now',
        });
        if (!ok) {
          return;
        }
      }

      setError(null);
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
      // it race-free even though uploads run concurrently.
      const dirCache = new Map<string, Promise<string | null>>();
      dirCache.set('', Promise.resolve(folderId));
      const ensureDir = (dirs: string[]): Promise<string | null> => {
        const key = dirs.join('/');
        let promise = dirCache.get(key);
        if (!promise) {
          const segment = dirs[dirs.length - 1]!;
          promise = ensureDir(dirs.slice(0, -1)).then((parentId) =>
            driveApi.ensureFolderPath(parentId, [segment]).then((result) => result.folderId),
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

      {!connected ? (
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
          <input {...getInputProps()} />

          {isDragActive && (
            <div className="pv-drop-overlay">
              <UploadPortal width={22} height={22} /> Drop files to upload here
            </div>
          )}

          <div className="pv-drive-toolbar">
            <Breadcrumb breadcrumb={drive.data?.breadcrumb ?? []} onNavigate={setFolderId} />
            <div className="pv-menu-wrap">
              <button
                className="pv-button"
                type="button"
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

          {drive.data?.currentFolder && (
            <div className="pv-folder-meta">
              <FolderIcon width={14} height={14} />
              {drive.data.currentFolder.name} — {formatSize(drive.data.currentFolder.totalBytes)} ·{' '}
              {drive.data.currentFolder.fileCount}{' '}
              {drive.data.currentFolder.fileCount === 1 ? 'file' : 'files'}
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
                onOpenFolder: setFolderId,
                onOpenFile: openFile,
                onMove: setMoving,
                onRenameFile: renameFile,
                onDeleteFile: deleteFile,
                onRenameFolder: renameFolder,
                onDeleteFolder: deleteFolder,
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
  onOpenFolder: (id: string) => void;
  onOpenFile: (file: FileDto) => void;
  onMove: (file: FileDto) => void;
  onRenameFile: (file: FileDto) => void;
  onDeleteFile: (file: FileDto) => void;
  onRenameFolder: (folder: FolderDto) => void;
  onDeleteFolder: (folder: FolderDto) => void;
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
          className="pv-row pv-row--clickable"
          onClick={() => props.onOpenFolder(folder.id)}
        >
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
            className={`pv-row${clickable ? ' pv-row--clickable' : ''}`}
            onClick={clickable ? () => props.onOpenFile(file) : undefined}
          >
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
          className="pv-grid-card pv-row--clickable"
          onClick={() => props.onOpenFolder(folder.id)}
        >
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
            className={`pv-grid-card${clickable ? ' pv-row--clickable' : ''}`}
            onClick={clickable ? () => props.onOpenFile(file) : undefined}
          >
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
