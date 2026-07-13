'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FileDto, FolderDto } from '@pocketverse/shared';
import { driveApi } from '@/lib/files';
import { ChevronRight, FolderIcon, OrbitLogo } from '@/components/icons';
import { Modal } from '@/components/ui';

/**
 * Folder picker as an expandable tree (the Drive pattern): the chevron
 * expands a folder to reveal its subfolders, clicking a row selects it as the
 * destination — selection and navigation are separate, so any nested folder
 * can be chosen without losing your place.
 */
export function MoveDialog({
  file,
  onClose,
  onMoved,
}: {
  file: FileDto;
  onClose: () => void;
  onMoved: () => void;
}) {
  // null = "My universe" (root). Preselect the file's current home so the
  // dialog opens showing where the file lives today.
  const [selectedId, setSelectedId] = useState<string | null>(file.folderId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCurrent = selectedId === file.folderId;

  async function move() {
    setBusy(true);
    setError(null);
    try {
      await driveApi.updateFile(file.id, { folderId: selectedId });
      onMoved();
      onClose();
    } catch {
      setError("Couldn't move the file. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Move “${file.name}”`} onClose={onClose}>
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
          {file.folderId === null && <span className="pv-tree-badge">current</span>}
        </div>
        <FolderChildren
          parentId={null}
          depth={1}
          selectedId={selectedId}
          currentId={file.folderId}
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
          disabled={busy || isCurrent}
          onClick={() => void move()}
        >
          {busy ? 'Moving…' : isCurrent ? 'Already in this folder' : 'Move here'}
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
  onSelect,
}: {
  parentId: string | null;
  depth: number;
  selectedId: string | null;
  currentId: string | null;
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
  onSelect,
}: {
  folder: FolderDto;
  depth: number;
  selectedId: string | null;
  currentId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = selectedId === folder.id;
  return (
    <>
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={open}
        className={`pv-tree-row${selected ? ' selected' : ''}`}
        style={{ paddingLeft: (depth - 1) * 20 + 8 }}
        onClick={() => onSelect(folder.id)}
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
          onSelect={onSelect}
        />
      )}
    </>
  );
}
