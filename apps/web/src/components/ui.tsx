'use client';

import { useEffect, type ReactNode } from 'react';
import type { FileStatusValue } from '@pocketverse/shared';
import { CheckIcon, XIcon } from '@/components/icons';

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="pv-modal-scrim"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className={`pv-modal${wide ? ' pv-modal--wide' : ''}`} role="dialog" aria-label={title}>
        <div className="pv-modal-head">
          <span>{title}</span>
          <button className="pv-iconbtn" type="button" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="pv-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="pv-empty">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

/** Consistent security/sync state colors across the app (handoff §3.5.3). */
export function StatusBadge({
  status,
  syncProgress,
}: {
  status: FileStatusValue;
  syncProgress: number | null;
}) {
  if (status === 'ready') {
    return (
      <span className="pv-badge pv-badge--ok">
        <CheckIcon width={11} height={11} /> stored
      </span>
    );
  }
  if (status === 'error') {
    return <span className="pv-badge pv-badge--warn">upload failed</span>;
  }
  return (
    <span className="pv-badge pv-badge--sync">
      <span className="pv-spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
      syncing {syncProgress ?? 0}%
    </span>
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    if (value < 1024) {
      break;
    }
    value /= 1024;
    unit = next;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
