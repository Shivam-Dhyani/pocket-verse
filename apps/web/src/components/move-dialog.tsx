'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FolderDto } from '@pocketverse/shared';
import { ApiError } from '@/lib/api';
import { driveApi } from '@/lib/files';
import { ChevronRight, FolderIcon, OrbitLogo } from '@/components/icons';
import { Modal } from '@/components/ui';

export interface MoveSelection {
  /** What the dialog's title reads, e.g. `Move "invoice.pdf"` or `Move 4 items`. */
  title: string;
  fileIds: string[];
  folderIds: string[];
  /** Where the selection lives today — preselected, and disabled as a no-op destination. */
  currentFolderId: string | null;
}

/**
 * Folder picker as an expandable tree (the Drive pattern): the chevron
 * expands a folder to reveal its subfolders, clicking a row selects it as the
 * destination — selection and navigation are separate, so any nested folder
 * can be chosen without losing your place.
 *
 * Handles one file, one folder, or any multi-selected mix the same way — the
 * selection bar's "Move" and a single row's "Move" both open this dialog,
 * just with a different `MoveSelection`.
 */
export function MoveDialog({
  selection,
  onClose,
  onMoved,
}: {
  selection: MoveSelection;
  onClose: () => void;
  onMoved: () => void;
}) {
  const { title, fileIds, folderIds, currentFolderId } = selection;
  // null = "My universe" (root). Preselect where the selection lives today so
  // the dialog opens showing its current home.
  const [selectedId, setSelectedId] = useState<string | null>(currentFolderId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCurrent = selectedId === currentFolderId;
  // A folder can't be moved into itself — the backend also rejects moving one
  // into its own descendants, which is checked there since it needs the tree.
  const isSelectedFolderItself = folderIds.includes(selectedId ?? '');

  async function move() {
    setBusy(true);
    setError(null);
    // Sequential, not parallel: mirrors deleteSelected's pattern, and keeps a
    // handful of failures (e.g. one folder would cycle into itself) from
    // racing each other into a confusing combined error.
    let failure: string | null = null;
    for (const id of fileIds) {
      try {
        await driveApi.updateFile(id, { folderId: selectedId });
      } catch (err) {
        failure ??= err instanceof ApiError ? err.message : "Couldn't move a file.";
      }
    }
    for (const id of folderIds) {
      try {
        await driveApi.updateFolder(id, { parentId: selectedId });
      } catch (err) {
        failure ??= err instanceof ApiError ? err.message : "Couldn't move a folder.";
      }
    }
    // Whatever succeeded should disappear from the current listing even if
    // something else in the batch failed.
    onMoved();
    if (failure) {
      setError(failure);
      setBusy(false);
      return;
    }
    onClose();
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p className="pv-sub" style={{ marginTop: 0 }}>
        Pick a destination — use the arrows to open folders.
      </p>

      {error && (
        <div className="pv-error" role="alert">
          {error}
        </div>
      )}

      <div className="pv-tree" role="tree">
        {/* Root ("My universe") is a selectable row like any other. */}
        <div
          role="treeitem"
          aria-selected={selectedId === null}
          className={`pv-tree-row${selectedId === null ? ' selected' : ''}`}
          onClick={() => setSelectedId(null)}
        >
          <span className="pv-tree-toggle" aria-hidden="true" />
          <OrbitLogo width={15} height={15} />
          <span className="pv-tree-name">My universe</span>
          {currentFolderId === null && <span className="pv-tree-badge">current</span>}
        </div>
        <FolderChildren
          parentId={null}
          depth={1}
          selectedId={selectedId}
          currentId={currentFolderId}
          excludedIds={folderIds}
          onSelect={setSelectedId}
        />
      </div>

      <div style={{ display: 'flex', gap: 'var(--pv-s2)', marginTop: 'var(--pv-s4)' }}>
        <button className="pv-button pv-button--ghost" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="pv-button"
          type="button"
          style={{ flex: 1 }}
          disabled={busy || isCurrent || isSelectedFolderItself}
          onClick={() => void move()}
        >
          {busy
            ? 'Moving…'
            : isCurrent
              ? 'Already here'
              : isSelectedFolderItself
                ? "Can't move inside itself"
                : 'Move here'}
        </button>
      </div>
    </Modal>
  );
}

function FolderChildren({
  parentId,
  depth,
  selectedId,
  currentId,
  excludedIds,
  onSelect,
}: {
  parentId: string | null;
  depth: number;
  selectedId: string | null;
  currentId: string | null;
  /** Folders being moved — not valid destinations, since a folder can't hold itself. */
  excludedIds: string[];
  onSelect: (id: string | null) => void;
}) {
  const listing = useQuery({
    queryKey: ['move-tree', parentId],
    queryFn: () => driveApi.list(parentId),
  });

  if (listing.isPending) {
    return (
      <div className="pv-tree-note" style={{ paddingLeft: depth * 20 + 8 }}>
        <span className="pv-spinner" style={{ width: 12, height: 12 }} /> Loading…
      </div>
    );
  }
  const folders = listing.data?.folders ?? [];
  if (folders.length === 0 && depth > 1) {
    return (
      <div className="pv-tree-note" style={{ paddingLeft: depth * 20 + 8 }}>
        No folders inside
      </div>
    );
  }
  return (
    <>
      {folders.map((folder) => (
        <FolderNode
          key={folder.id}
          folder={folder}
          depth={depth}
          selectedId={selectedId}
          currentId={currentId}
          excludedIds={excludedIds}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function FolderNode({
  folder,
  depth,
  selectedId,
  currentId,
  excludedIds,
  onSelect,
}: {
  folder: FolderDto;
  depth: number;
  selectedId: string | null;
  currentId: string | null;
  excludedIds: string[];
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = selectedId === folder.id;
  // A folder being moved (or any of its descendants — the backend checks
  // those) can't be its own destination. Only direct self-moves are excluded
  // here since descendants aren't known client-side without walking the tree;
  // a descendant pick still fails, just server-side, with the same message.
  const excluded = excludedIds.includes(folder.id);
  return (
    <>
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={open}
        aria-disabled={excluded}
        title={excluded ? "A folder can't be moved inside itself" : undefined}
        className={`pv-tree-row${selected ? ' selected' : ''}${excluded ? ' disabled' : ''}`}
        style={{ paddingLeft: (depth - 1) * 20 + 8 }}
        onClick={() => !excluded && onSelect(folder.id)}
      >
        <button
          type="button"
          className={`pv-tree-toggle${open ? ' open' : ''}`}
          aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
        >
          <ChevronRight width={13} height={13} />
        </button>
        <FolderIcon width={15} height={15} />
        <span className="pv-tree-name">{folder.name}</span>
        {currentId === folder.id && <span className="pv-tree-badge">current</span>}
      </div>
      {open && (
        <FolderChildren
          parentId={folder.id}
          depth={depth + 1}
          selectedId={selectedId}
          currentId={currentId}
          excludedIds={excludedIds}
          onSelect={onSelect}
        />
      )}
    </>
  );
}
