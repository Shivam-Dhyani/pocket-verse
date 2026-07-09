'use client';

import { useEffect, useState } from 'react';
import type { FileDto } from '@pocketverse/shared';
import { downloadFile, fileUrl } from '@/lib/files';
import { DownloadIcon } from '@/components/icons';
import { Modal } from '@/components/ui';

export function PreviewModal({ file, onClose }: { file: FileDto; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fileUrl(file.id, 'inline')
      .then((value) => active && setUrl(value))
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [file.id]);

  return (
    <Modal title={file.name} onClose={onClose} wide>
      {error ? (
        <p className="pv-footnote">Could not load a preview. Try downloading instead.</p>
      ) : !url ? (
        <p className="pv-footnote">
          <span className="pv-spinner" /> Loading preview…
        </p>
      ) : file.mimeType === 'application/pdf' ? (
        <iframe className="pv-preview-frame" src={url} title={file.name} />
      ) : (
        <img className="pv-preview-img" src={url} alt={file.name} />
      )}
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
