'use client';

import { useUploadsStore, pauseUpload, resumeUpload, dismissUpload } from '@/stores/uploads';
import { PauseIcon, PlayIcon, XIcon } from '@/components/icons';

export function UploadPanel({ onSettled }: { onSettled: () => void }) {
  const uploads = useUploadsStore((state) => state.uploads);
  const entries = Object.values(uploads);
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="pv-uploads">
      {entries.map((item) => (
        <div className="pv-upload-item" key={item.id}>
          <div className="top">
            <span className="name">
              {item.state === 'syncing' ? 'Uploaded ' : 'Uploading '}
              {item.name}
            </span>
            <span className="pct">
              {item.state === 'error'
                ? (item.error ?? 'Failed')
                : item.state === 'paused'
                  ? 'Paused'
                  : item.state === 'syncing'
                    ? 'Syncing to storage…'
                    : `${Math.round(item.fraction * 100)}%`}
            </span>
            {item.state === 'uploading' && (
              <button
                className="pv-iconbtn"
                type="button"
                title="Pause"
                onClick={() => pauseUpload(item.id)}
              >
                <PauseIcon width={15} height={15} />
              </button>
            )}
            {(item.state === 'paused' || item.state === 'error') && (
              <button
                className="pv-iconbtn"
                type="button"
                title="Resume"
                onClick={() => void resumeUpload(item.id, onSettled)}
              >
                <PlayIcon width={15} height={15} />
              </button>
            )}
            {item.state !== 'uploading' && (
              <button
                className="pv-iconbtn"
                type="button"
                title="Dismiss"
                onClick={() => dismissUpload(item.id)}
              >
                <XIcon width={15} height={15} />
              </button>
            )}
          </div>
          <span className="pv-progress-track">
            <span
              className="pv-progress-bar"
              style={{
                width: `${item.fraction * 100}%`,
                opacity: item.state === 'error' ? 0.4 : 1,
              }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}
