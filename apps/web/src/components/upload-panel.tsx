'use client';

import {
  dismissGroup,
  pauseGroup,
  resumeGroup,
  toUploadGroups,
  useUploadsStore,
  type UploadGroup,
} from '@/stores/uploads';
import { FolderIcon, PauseIcon, PlayIcon, UploadPortal, XIcon } from '@/components/icons';

export function UploadPanel({ onSettled }: { onSettled: () => void }) {
  const uploads = useUploadsStore((state) => state.uploads);
  const groups = toUploadGroups(uploads);
  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="pv-uploads">
      {groups.map((group) => (
        <UploadRow key={group.key} group={group} onSettled={onSettled} />
      ))}
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
  const isFolder = group.kind === 'folder';
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
        {group.state === 'uploading' && (
          <button
            className="pv-iconbtn"
            type="button"
            title="Pause"
            onClick={() => pauseGroup(group.entryIds)}
          >
            <PauseIcon width={15} height={15} />
          </button>
        )}
        {(group.state === 'paused' || group.state === 'error') && (
          <button
            className="pv-iconbtn"
            type="button"
            title="Resume"
            onClick={() => resumeGroup(group.entryIds, onSettled)}
          >
            <PlayIcon width={15} height={15} />
          </button>
        )}
        {group.state !== 'uploading' && (
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
