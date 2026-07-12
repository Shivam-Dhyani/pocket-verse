'use client';

import { AppHeader } from '@/components/app-header';
import {
  ActivityIcon,
  FolderIcon,
  LockIcon,
  OrbitLogo,
  ShieldIcon,
  UploadPortal,
} from '@/components/icons';

const FEATURES = [
  {
    icon: <UploadPortal width={20} height={20} />,
    title: 'Truly unlimited storage',
    body: 'Your files live in storage you own, with no quota from us and no platform cap on total space. Files of any size are welcome — big ones are split into parts behind the scenes and reassembled when you download.',
  },
  {
    icon: <FolderIcon width={20} height={20} />,
    title: 'A real drive, not a dump',
    body: 'Folders (nested as deep as you like), drag-and-drop for files and whole folder trees, search, previews for images and PDFs, move/rename, list and grid views — everything you expect from a file home.',
  },
  {
    icon: <LockIcon width={20} height={20} />,
    title: 'Resumable, honest transfers',
    body: 'Uploads happen in small parts and survive hiccups: pause, resume, or retry from where things stopped. Progress you see is progress that actually happened — never an animation pretending to be one.',
  },
  {
    icon: <ShieldIcon width={20} height={20} />,
    title: 'Security you can read',
    body: 'Your storage connection is encrypted at rest with AES-256-GCM. The Security page explains in plain language what we can and cannot see — including the parts other services would rather not mention.',
  },
  {
    icon: <ActivityIcon width={20} height={20} />,
    title: 'A memory of everything',
    body: 'Sign-ins, connections, uploads, deletions — and even data loss, if it ever happens — are written to an activity log only you can read. You will never have to wonder what happened to a file.',
  },
  {
    icon: <OrbitLogo width={20} height={20} />,
    title: 'You can always leave',
    body: 'The bytes sit in your own storage account, not on our servers. Disconnect at any time and the files remain yours, right where they are.',
  },
];

const COMPARISON: {
  point: string;
  pocketverse: string;
  others: string;
}[] = [
  {
    point: 'Free space',
    pocketverse: 'Unlimited — no quota, no tiers',
    others: 'Google Drive: 15 GB · iCloud: 5 GB, then paid plans',
  },
  {
    point: 'Where your files live',
    pocketverse: 'In a private channel of your own storage account',
    others: "On Google's / Apple's servers, under their account",
  },
  {
    point: 'What the service keeps',
    pocketverse: 'Only the map (names, folders, sizes) — never the file bytes',
    others: 'The files themselves',
  },
  {
    point: 'If you stop using it',
    pocketverse: 'Disconnect and your files stay in your account',
    others: 'Files are locked to the platform; export first',
  },
  {
    point: 'Transparency',
    pocketverse: 'Plain-language security page + your own activity log',
    others: 'Policy documents',
  },
  {
    point: 'Where they win (honestly)',
    pocketverse: 'Transfers are slower, and there is no sharing or live document editing yet',
    others: 'Faster CDNs, collaboration, native mobile apps',
  },
];

export default function AboutPage() {
  return (
    <div className="pv-app">
      <AppHeader />
      <article className="pv-page">
        <h1>What Pocketverse is</h1>
        <p className="pv-sub">
          A file home built on one idea: your files should live in storage <em>you</em> own — with
          the polish of a modern drive and none of the quota anxiety.
        </p>

        <section className="pv-section">
          <h2>What you get</h2>
          <div className="pv-feature-grid">
            {FEATURES.map((feature) => (
              <div className="pv-feature-card" key={feature.title}>
                <span className="pv-row-icon">{feature.icon}</span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="pv-section">
          <h2>How it compares to Google Drive &amp; iCloud</h2>
          <p>
            We want you choosing with open eyes — including the rows where the big players are
            genuinely better.
          </p>
          <div className="pv-compare">
            <div className="pv-compare-head" aria-hidden="true">
              <span />
              <span className="us">Pocketverse</span>
              <span className="them">Google Drive / iCloud</span>
            </div>
            {COMPARISON.map((row) => (
              <div className="pv-compare-row" key={row.point}>
                <span className="pv-compare-point">{row.point}</span>
                <span className="pv-compare-us">
                  <strong>Pocketverse:</strong> {row.pocketverse}
                </span>
                <span className="pv-compare-them">
                  <strong>Drive / iCloud:</strong> {row.others}
                </span>
              </div>
            ))}
          </div>
        </section>
      </article>
    </div>
  );
}
