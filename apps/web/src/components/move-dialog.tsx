'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FileDto, FolderDto } from '@pocketverse/shared';
import { driveApi } from '@/lib/files';
import { FolderIcon } from '@/components/icons';
import { Modal } from '@/components/ui';

/**
 * Simple folder picker: walk into subfolders, then "Move here". Reuses the
 * drive listing endpoint so it always mirrors the real tree.
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
  const [folderId, setFolderId] = useState<string | null>(null);
  const [trail, setTrail] = useState<FolderDto[]>([]);
  const [busy, setBusy] = useState(false);

  const listing = useQuery({
    queryKey: ['drive', folderId, 'move'],
    queryFn: () => driveApi.list(folderId),
  });

  async function moveHere() {
    setBusy(true);
    try {
      await driveApi.updateFile(file.id, { folderId });
      onMoved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Move “${file.name}”`} onClose={onClose}>
      <nav className="pv-breadcrumb" style={{ marginBottom: 'var(--pv-s3)' }}>
        <button
          type="button"
          className={folderId === null ? 'current' : ''}
          onClick={() => {
            setFolderId(null);
            setTrail([]);
          }}
        >
          My universe
        </button>
        {trail.map((folder, index) => (
          <span key={folder.id}>
            {' / '}
            <button
              type="button"
              className={folder.id === folderId ? 'current' : ''}
              onClick={() => {
                setFolderId(folder.id);
                setTrail(trail.slice(0, index + 1));
              }}
            >
              {folder.name}
            </button>
          </span>
        ))}
      </nav>

      <ul className="pv-list" style={{ minHeight: 120 }}>
        {listing.data?.folders.map((folder) => (
          <li key={folder.id} className="pv-row">
            <button
              type="button"
              className="pv-row-name"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--pv-s2)' }}
              onClick={() => {
                setFolderId(folder.id);
                setTrail([...trail, folder]);
              }}
            >
              <FolderIcon width={16} height={16} /> {folder.name}
            </button>
          </li>
        ))}
        {listing.data && listing.data.folders.length === 0 && (
          <li className="pv-footnote" style={{ padding: 'var(--pv-s4)' }}>
            No subfolders here.
          </li>
        )}
      </ul>

      <div style={{ display: 'flex', gap: 'var(--pv-s2)', marginTop: 'var(--pv-s4)' }}>
        <button
          className="pv-button pv-button--block"
          type="button"
          disabled={busy}
          onClick={moveHere}
        >
          {busy
            ? 'Moving…'
            : folderId
              ? `Move to ${trail[trail.length - 1]?.name}`
              : 'Move to My universe'}
        </button>
      </div>
    </Modal>
  );
}
