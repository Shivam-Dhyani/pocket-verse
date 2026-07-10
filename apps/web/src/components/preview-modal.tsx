'use client';

import { useEffect, useState } from 'react';
import type { FileDto } from '@pocketverse/shared';
import { canPreview, downloadFile, fileUrl } from '@/lib/files';
import { DownloadIcon, iconForMime } from '@/components/icons';
import { Modal, formatSize } from '@/components/ui';

type Phase = 'preparing' | 'loading' | 'ready' | 'error';

export function PreviewModal({ file, onClose }: { file: FileDto; onClose: () => void }) {
  const previewable = canPreview(file.mimeType);

  return (
    <Modal title={file.name} onClose={onClose} wide={previewable}>
      {previewable ? (
        <RenderedPreview file={file} />
      ) : (
        <OpenOnDevice file={file} onClose={onClose} />
      )}
    </Modal>
  );
}

/** Calm, suggestive hand-off for file types that open best in a native app. */
function OpenOnDevice({ file, onClose }: { file: FileDto; onClose: () => void }) {
  const Icon = iconForMime(file.mimeType);
  return (
    <div className="pv-open-device">
      <span className="pv-open-device-icon">
        <Icon width={34} height={34} />
      </span>
      <h3>Best opened on your device</h3>
      <p>
        Photos and PDFs preview right here. This one opens in full quality with the app it’s made
        for — download it whenever you’re ready.
      </p>
      <p className="pv-open-device-meta">{formatSize(file.size)}</p>
      <div className="pv-open-device-actions">
        <button
          className="pv-button"
          type="button"
          onClick={() => {
            void downloadFile(file);
            onClose();
          }}
        >
          <DownloadIcon width={16} height={16} /> Download
        </button>
        <button className="pv-button pv-button--ghost" type="button" onClick={onClose}>
          Not now
        </button>
      </div>
    </div>
  );
}

function RenderedPreview({ file }: { file: FileDto }) {
  const [url, setUrl] = useState<string | null>(null);
  // preparing = minting token; loading = bytes streaming from storage; ready = shown.
  const [phase, setPhase] = useState<Phase>('preparing');

  useEffect(() => {
    let active = true;
    fileUrl(file.id, 'inline')
      .then((value) => {
        if (active) {
          setUrl(value);
          setPhase('loading');
        }
      })
      .catch(() => active && setPhase('error'));
    return () => {
      active = false;
    };
  }, [file.id]);

  const isPdf = file.mimeType === 'application/pdf';

  return (
    <>
      <div className="pv-preview-stage">
        {(phase === 'preparing' || phase === 'loading') && (
          <div className="pv-preview-loading">
            <span className="pv-spinner" />
            <span>
              {phase === 'preparing' ? 'Preparing preview…' : 'Loading from your storage…'}
            </span>
          </div>
        )}

        {phase === 'error' && (
          <div className="pv-open-device">
            <p>We couldn’t open a preview this time.</p>
            <button className="pv-button" type="button" onClick={() => void downloadFile(file)}>
              <DownloadIcon width={16} height={16} /> Download instead
            </button>
          </div>
        )}

        {url &&
          phase !== 'error' &&
          (isPdf ? (
            <iframe
              className="pv-preview-frame"
              src={url}
              title={file.name}
              style={{ display: phase === 'ready' ? 'block' : 'none' }}
              onLoad={() => setPhase('ready')}
              onError={() => setPhase('error')}
            />
          ) : (
            <img
              className="pv-preview-img"
              src={url}
              alt={file.name}
              style={{ display: phase === 'ready' ? 'block' : 'none' }}
              onLoad={() => setPhase('ready')}
              onError={() => setPhase('error')}
            />
          ))}
      </div>

      <div style={{ marginTop: 'var(--pv-s4)', textAlign: 'center' }}>
        <button
          className="pv-button pv-button--ghost"
          type="button"
          onClick={() => void downloadFile(file)}
        >
          <DownloadIcon width={16} height={16} /> Download
        </button>
      </div>
    </>
  );
}
