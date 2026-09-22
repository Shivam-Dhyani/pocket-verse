'use client';

import { useIsTouch, useLongPress } from '@/lib/pointer';
import { downloadFile } from '@/lib/files';
import type { FileDto, FolderDto } from '@pocketverse/shared';
import { RowActions, type RowAction } from '@/components/row-actions';
import { StatusBadge, formatSize } from '@/components/ui';
import {
  DownloadIcon,
  FolderIcon,
  iconForMime,
  MoveIcon,
  PencilIcon,
  TrashIcon,
} from '@/components/icons';

/**
 * How the drive renders its contents — list rows and grid cards, their press
 * behaviour, and their per-item actions.
 *
 * Kept apart from the drive page on purpose: the page owns state and side
 * effects (queries, uploads, deletes, dialogs, history), while everything here
 * is driven purely by the ViewProps handed to it. That split is what keeps a
 * screen with this much behaviour readable.
 */
export interface ViewProps {
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
  /** True once anything is selected — on touch, taps then toggle instead of open. */
  selectionActive: boolean;
  /** Items with a delete in flight; rendered inert until it settles. */
  deletingFiles: ReadonlySet<string>;
  deletingFolders: ReadonlySet<string>;
}

/**
 * Wires up how an item responds to being pressed.
 *
 * Touch behaves the way a phone's gallery does: press and hold to start
 * selecting, after which a plain tap toggles items instead of opening them.
 * That is why touch layouts show no checkboxes until a selection exists —
 * holding is the entry point, so a checkbox on every row is just noise.
 * Mouse input is untouched: the hover checkbox selects, a click opens.
 */
export function useItemPress({
  onToggle,
  onOpen,
  selectionActive,
  disabled,
}: {
  onToggle: () => void;
  onOpen?: () => void;
  selectionActive: boolean;
  /** Item is mid-delete: swallow every gesture rather than acting on it. */
  disabled?: boolean;
}) {
  const touch = useIsTouch();
  const { consumed, handlers } = useLongPress(() => {
    if (!disabled) {
      onToggle();
    }
  });

  return {
    ...handlers,
    'aria-disabled': disabled || undefined,
    onClick: () => {
      if (disabled) {
        return;
      }
      if (consumed.current) {
        // This click is the tail of a long press — it already selected.
        consumed.current = false;
        return;
      }
      if (touch && selectionActive) {
        onToggle();
        return;
      }
      onOpen?.();
    },
  };
}

/** Row/card checkbox — stops propagation so selecting never opens the item. */
export function SelectBox({
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

const ACTION_ICON = { width: 16, height: 16 };

/** Replaces an item's actions while its delete is in flight. */
export function DeletingMark() {
  return (
    <span className="pv-row-actions pv-row-deleting-mark">
      <span className="pv-spinner" />
      <span>Deleting…</span>
    </span>
  );
}

export function fileActions(file: FileDto, props: ViewProps) {
  const actions: RowAction[] = [];
  if (file.status === 'ready') {
    actions.push({
      label: 'Download',
      icon: <DownloadIcon {...ACTION_ICON} />,
      onSelect: () => void downloadFile(file),
    });
  }
  actions.push(
    {
      label: 'Rename',
      icon: <PencilIcon {...ACTION_ICON} />,
      onSelect: () => props.onRenameFile(file),
    },
    { label: 'Move', icon: <MoveIcon {...ACTION_ICON} />, onSelect: () => props.onMove(file) },
    {
      label: 'Delete',
      icon: <TrashIcon {...ACTION_ICON} />,
      onSelect: () => props.onDeleteFile(file),
      danger: true,
    },
  );
  return <RowActions actions={actions} />;
}

export function folderActions(folder: FolderDto, props: ViewProps) {
  const actions: RowAction[] = [
    {
      label: 'Download as zip',
      icon: <DownloadIcon {...ACTION_ICON} />,
      onSelect: () => props.onDownloadFolder(folder),
    },
    {
      label: 'Rename',
      icon: <PencilIcon {...ACTION_ICON} />,
      onSelect: () => props.onRenameFolder(folder),
    },
    {
      label: 'Delete',
      icon: <TrashIcon {...ACTION_ICON} />,
      onSelect: () => props.onDeleteFolder(folder),
      danger: true,
    },
  ];
  return <RowActions actions={actions} />;
}

export function FolderRow({ folder, view }: { folder: FolderDto; view: ViewProps }) {
  const selected = view.selectedFolders.has(folder.id);
  const deleting = view.deletingFolders.has(folder.id);
  const press = useItemPress({
    onToggle: () => view.onToggleFolder(folder.id),
    onOpen: () => view.onOpenFolder(folder.id),
    selectionActive: view.selectionActive,
    disabled: deleting,
  });
  return (
    <li
      className={`pv-row pv-row--clickable${selected ? ' selected' : ''}${deleting ? ' pv-row--deleting' : ''}`}
      {...press}
    >
      <SelectBox
        checked={selected}
        label={`Select ${folder.name}`}
        onToggle={() => view.onToggleFolder(folder.id)}
      />
      <span className="pv-row-icon">
        <FolderIcon />
      </span>
      <span className="pv-row-main">
        <span className="pv-row-name">{folder.name}</span>
        <span className="pv-row-meta">Folder</span>
      </span>
      {deleting ? <DeletingMark /> : folderActions(folder, view)}
    </li>
  );
}

export function FileRow({ file, view }: { file: FileDto; view: ViewProps }) {
  const selected = view.selectedFiles.has(file.id);
  const deleting = view.deletingFiles.has(file.id);
  const clickable = file.status === 'ready' && !deleting;
  const Icon = iconForMime(file.mimeType);
  const press = useItemPress({
    onToggle: () => view.onToggleFile(file.id),
    onOpen: clickable ? () => view.onOpenFile(file) : undefined,
    selectionActive: view.selectionActive,
    disabled: deleting,
  });
  return (
    <li
      className={`pv-row${clickable ? ' pv-row--clickable' : ''}${selected ? ' selected' : ''}${deleting ? ' pv-row--deleting' : ''}`}
      {...press}
    >
      <SelectBox
        checked={selected}
        label={`Select ${file.name}`}
        onToggle={() => view.onToggleFile(file.id)}
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
      {deleting ? <DeletingMark /> : fileActions(file, view)}
    </li>
  );
}

export function ListView(props: ViewProps) {
  return (
    <ul className="pv-list">
      {props.folders.map((folder) => (
        <FolderRow key={folder.id} folder={folder} view={props} />
      ))}
      {props.files.map((file) => (
        <FileRow key={file.id} file={file} view={props} />
      ))}
    </ul>
  );
}

export function FolderCard({ folder, view }: { folder: FolderDto; view: ViewProps }) {
  const selected = view.selectedFolders.has(folder.id);
  const deleting = view.deletingFolders.has(folder.id);
  const press = useItemPress({
    onToggle: () => view.onToggleFolder(folder.id),
    onOpen: () => view.onOpenFolder(folder.id),
    selectionActive: view.selectionActive,
    disabled: deleting,
  });
  return (
    <div
      className={`pv-grid-card pv-row--clickable${selected ? ' selected' : ''}${deleting ? ' pv-row--deleting' : ''}`}
      {...press}
    >
      <SelectBox
        checked={selected}
        label={`Select ${folder.name}`}
        onToggle={() => view.onToggleFolder(folder.id)}
      />
      <span className="pv-row-icon">
        <FolderIcon width={26} height={26} />
      </span>
      <span className="pv-row-name" style={{ fontWeight: 500 }}>
        {folder.name}
      </span>
      {deleting ? <DeletingMark /> : folderActions(folder, view)}
    </div>
  );
}

export function FileCard({ file, view }: { file: FileDto; view: ViewProps }) {
  const selected = view.selectedFiles.has(file.id);
  const deleting = view.deletingFiles.has(file.id);
  const clickable = file.status === 'ready' && !deleting;
  const Icon = iconForMime(file.mimeType);
  const press = useItemPress({
    onToggle: () => view.onToggleFile(file.id),
    onOpen: clickable ? () => view.onOpenFile(file) : undefined,
    selectionActive: view.selectionActive,
    disabled: deleting,
  });
  return (
    <div
      className={`pv-grid-card${clickable ? ' pv-row--clickable' : ''}${selected ? ' selected' : ''}${deleting ? ' pv-row--deleting' : ''}`}
      {...press}
    >
      <SelectBox
        checked={selected}
        label={`Select ${file.name}`}
        onToggle={() => view.onToggleFile(file.id)}
      />
      <span className="pv-row-icon">
        <Icon width={26} height={26} />
      </span>
      <span className="pv-row-name" style={{ fontWeight: 500 }}>
        {file.name}
      </span>
      <span className="pv-row-meta">{formatSize(file.size)}</span>
      <StatusBadge status={file.status} syncProgress={file.syncProgress} />
      {deleting ? <DeletingMark /> : fileActions(file, view)}
    </div>
  );
}

export function GridView(props: ViewProps) {
  return (
    <div className="pv-grid">
      {props.folders.map((folder) => (
        <FolderCard key={folder.id} folder={folder} view={props} />
      ))}
      {props.files.map((file) => (
        <FileCard key={file.id} file={file} view={props} />
      ))}
    </div>
  );
}
