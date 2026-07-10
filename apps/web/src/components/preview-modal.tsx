'use client';

import { useEffect, useState } from 'react';
import type { FileDto } from '@pocketverse/shared';
import { downloadFile, fileUrl } from '@/lib/files';
import { DownloadIcon } from '@/components/icons';
import { Modal } from '@/components/ui';

type Phase = 'preparing' | 'loading' | 'ready' | 'error';

export function PreviewModal({ file, onClose }: { file: FileDto; onClose: () => void }) {
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
    <Modal title={file.name} onClose={onClose} wide>
      <div className="pv-preview-stage">
        {/* Spinner sits under the media until it finishes loading. */}
        {(phase === 'preparing' || phase === 'loading') && (
          <div className="pv-preview-loading">
            <span className="pv-spinner" />
            <span>
              {phase === 'preparing' ? 'Preparing preview…' : 'Loading from your storage…'}
            </span>
          </div>
        )}

        {phase === 'error' && (
          <p className="pv-footnote">Could not load a preview. Try downloading instead.</p>
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
    </Modal>
  );
}
