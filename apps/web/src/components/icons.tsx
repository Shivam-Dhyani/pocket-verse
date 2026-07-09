import type { SVGProps } from 'react';

/** Minimal inline icon set — orbit/portal motif, stroke-based, currentColor. */
function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: props.width ?? 18,
    height: props.height ?? 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  };
}

export const OrbitLogo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
    <ellipse cx="12" cy="12" rx="9.5" ry="4.2" transform="rotate(-24 12 12)" />
    <circle cx="19.6" cy="7.4" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

export const UploadPortal = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="18" rx="7.5" ry="2.6" />
    <path d="M12 16V4" />
    <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
  </svg>
);

export const FolderIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.4h9A1.5 1.5 0 0 1 21 9.9v8.1a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z" />
  </svg>
);

export const FileIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6 3.5h8L19 8.5v12H6Z" />
    <path d="M14 3.5v5h5" />
  </svg>
);

export const ImageIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4.5 17 4.5-4 3.5 3 3-2.5 4 3.5" />
  </svg>
);

export const VideoIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5.5" width="13" height="13" rx="2" />
    <path d="m16.5 10 4-2.5v9l-4-2.5" />
  </svg>
);

export const AudioIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9 18V6l10-2v12" />
    <circle cx="6.8" cy="18" r="2.2" />
    <circle cx="16.8" cy="16" r="2.2" />
  </svg>
);

export const ArchiveIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="3.5" y="4" width="17" height="4.5" rx="1" />
    <path d="M5 8.5V20h14V8.5" />
    <path d="M10 12.5h4" />
  </svg>
);

export const ShieldIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3 5 6v5.5c0 4.4 3 7.7 7 9.5 4-1.8 7-5.1 7-9.5V6Z" />
    <path d="m9.2 11.8 2 2 3.6-3.8" />
  </svg>
);

export const LockIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </svg>
);

export const SearchIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.4-4.4" />
  </svg>
);

export const GridIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </svg>
);

export const ListIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 6.5h1M4 12h1M4 17.5h1M9 6.5h11M9 12h11M9 17.5h11" />
  </svg>
);

export const DownloadIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 4v11" />
    <path d="m7.5 11 4.5 4.5L16.5 11" />
    <path d="M5 19.5h14" />
  </svg>
);

export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5 7.5 20h9l1-13.5" />
  </svg>
);

export const PencilIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m4 20 .8-3.6L16.6 4.6a2 2 0 0 1 2.8 2.8L7.6 19.2Z" />
  </svg>
);

export const MoveIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.4h9A1.5 1.5 0 0 1 21 9.9v8.1a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z" />
    <path d="M10 14.5h6m0 0-2-2m2 2-2 2" />
  </svg>
);

export const EyeIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

export const XIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m4.5 12.5 5 5L19.5 7" />
  </svg>
);

export const SunIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" />
  </svg>
);

export const MoonIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />
  </svg>
);

export const ActivityIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 12h4l2.5-6.5 5 13L17 12h4" />
  </svg>
);

export const PauseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9 5.5v13M15 5.5v13" />
  </svg>
);

export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 5.5 18 12 8 18.5Z" />
  </svg>
);

export const ChevronRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <path d="m9 5.5 6.5 6.5L9 18.5" />
  </svg>
);

export function iconForMime(mimeType: string) {
  if (mimeType.startsWith('image/')) return ImageIcon;
  if (mimeType.startsWith('video/')) return VideoIcon;
  if (mimeType.startsWith('audio/')) return AudioIcon;
  if (/zip|rar|7z|tar|gzip/.test(mimeType)) return ArchiveIcon;
  return FileIcon;
}
