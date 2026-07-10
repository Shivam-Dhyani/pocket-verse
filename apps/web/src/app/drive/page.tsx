'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { FileDto, FolderDto } from '@pocketverse/shared';
import { api, ApiError } from '@/lib/api';
import { connectionApi } from '@/lib/connection';
import { canPreview, downloadFile, driveApi } from '@/lib/files';
import { activeUploadFileIds, startUpload, useUploadsStore } from '@/stores/uploads';
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
  EyeIcon,
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

  const onDrop = useCallback(
    (accepted: File[]) => {
      setError(null);
      for (const file of accepted) {
        void startUpload(file, folderId, refresh);
      }
    },
    [folderId, refresh],
  );
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    disabled: !connected,
  });

  async function act(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      onError(err);
    }
  }

  // Clicking a file opens it: preview if the browser can render it, else download.
  function openFile(file: FileDto) {
    if (file.status !== 'ready') {
      return;
    }
    if (canPreview(file.mimeType)) {
      setPreview(file);
    } else {
      void downloadFile(file);
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
      await act(() => driveApi.createFolder({ name, parentId: folderId }));
    }
  }

  async function renameFile(file: FileDto) {
    const name = await dialogs.prompt({
      title: 'Rename file',
      label: 'New name',
      initial: file.name,
    });
    if (name && name !== file.name) {
      await act(() => driveApi.updateFile(file.id, { name }));
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
      await act(() => driveApi.deleteFile(file.id));
    }
  }

  async function renameFolder(folder: FolderDto) {
    const name = await dialogs.prompt({
      title: 'Rename folder',
      label: 'New name',
      initial: folder.name,
    });
    if (name && name !== folder.name) {
      await act(() => driveApi.updateFolder(folder.id, { name }));
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
      await act(() => driveApi.deleteFolder(folder.id));
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
            <button className="pv-button" type="button" onClick={open}>
              <UploadPortal width={16} height={16} /> Upload
            </button>
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
                onPreview: setPreview,
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
  onPreview: (file: FileDto) => void;
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
      {file.status === 'ready' && canPreview(file.mimeType) && (
        <button
          className="pv-iconbtn"
          type="button"
          title="Preview"
          onClick={() => props.onPreview(file)}
        >
          <EyeIcon width={16} height={16} />
        </button>
      )}
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
