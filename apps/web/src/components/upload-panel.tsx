'use client';

import {
  cancelUploads,
  dismissGroup,
  resumeGroup,
  toUploadGroups,
  useUploadsStore,
  type UploadGroup,
} from '@/stores/uploads';
import { useDialogs } from '@/components/dialogs';
import { FolderIcon, PlayIcon, UploadPortal, XIcon } from '@/components/icons';

export function UploadPanel({ onSettled }: { onSettled: () => void }) {
  const uploads = useUploadsStore((state) => state.uploads);
  const groups = toUploadGroups(uploads);
  if (groups.length === 0) {
    return null;
  }
  const anyActive = groups.some((group) => group.state === 'uploading' || group.state === 'paused');

  return (
    <div className="pv-uploads">
      {groups.map((group) => (
        <UploadRow key={group.key} group={group} onSettled={onSettled} />
      ))}
      {anyActive && (
        <p className="pv-footnote" style={{ margin: 'var(--pv-s2) 0 0' }}>
          Keep this page open until uploads finish — closing or refreshing stops them.
        </p>
      )}
    </div>
  );
}

function statusText(group: UploadGroup): string {
  switch (group.state) {
    case 'error':
      return group.errorCount > 1 ? `${group.errorCount} failed` : 'Failed';
    case 'paused':
      return 'Paused';
    case 'syncing':
      return 'Syncing to storage…';
    default:
      return `${Math.round(group.fraction * 100)}%`;
  }
}

function UploadRow({ group, onSettled }: { group: UploadGroup; onSettled: () => void }) {
  const dialogs = useDialogs();
  const isFolder = group.kind === 'folder';

  async function confirmCancel() {
    const what = isFolder ? `“${group.label}” and its files` : `“${group.label}”`;
    const ok = await dialogs.confirm({
      title: 'Cancel this upload?',
      message: `This stops the upload of ${what}. Anything from it that already reached your drive will be removed — from Pocketverse and from your Telegram storage — so nothing arrives half-finished.`,
      confirmLabel: 'Cancel upload',
      cancelLabel: 'Keep uploading',
      danger: true,
    });
    if (ok) {
      cancelUploads(group.entryIds, onSettled);
    }
  }

  return (
    <div className="pv-upload-item">
      <div className="top">
        <span className="pv-row-icon">
          {isFolder ? (
            <FolderIcon width={16} height={16} />
          ) : (
            <UploadPortal width={16} height={16} />
          )}
        </span>
        <span className="name">
          {group.state === 'syncing' ? 'Uploaded ' : 'Uploading '}
          {group.label}
          {isFolder && (
            <span className="pv-upload-count">
              {' '}
              · {group.totalCount} {group.totalCount === 1 ? 'file' : 'files'}
            </span>
          )}
        </span>
        <span className="pct">{statusText(group)}</span>
        {(group.state === 'uploading' || group.state === 'paused') && (
          <button
            className="pv-iconbtn"
            type="button"
            title="Cancel upload"
            onClick={() => void confirmCancel()}
          >
            <XIcon width={15} height={15} />
          </button>
        )}
        {group.state === 'error' && (
          <button
            className="pv-iconbtn"
            type="button"
            title="Retry"
            onClick={() => resumeGroup(group.entryIds, onSettled)}
          >
            <PlayIcon width={15} height={15} />
          </button>
        )}
        {(group.state === 'error' || group.state === 'syncing') && (
          <button
            className="pv-iconbtn"
            type="button"
            title="Dismiss"
            onClick={() => dismissGroup(group.entryIds)}
          >
            <XIcon width={15} height={15} />
          </button>
        )}
      </div>
      <span className="pv-progress-track">
        <span
          className="pv-progress-bar"
          style={{
            width: `${group.fraction * 100}%`,
            opacity: group.state === 'error' ? 0.4 : 1,
          }}
        />
      </span>
    </div>
  );
}
