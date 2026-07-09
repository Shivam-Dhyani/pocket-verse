'use client';

import Link from 'next/link';
import { AppHeader } from '@/components/app-header';
import { LockIcon, ShieldIcon } from '@/components/icons';

export default function SecurityPage() {
  return (
    <div className="pv-app">
      <AppHeader />
      <article className="pv-page">
        <h1>How Pocketverse keeps you safe</h1>
        <p className="pv-sub">
          Plain language, no marketing. Here is exactly what we do with your data — and what we can
          and cannot see.
        </p>

        <section className="pv-section">
          <h2>
            <LockIcon width={18} height={18} /> Your storage connection is encrypted
          </h2>
          <p>
            To use your account as storage, Pocketverse holds an access key for it. That key is
            encrypted at rest with <strong>AES-256-GCM</strong> using envelope encryption: a
            per-connection data key, wrapped by a master key that lives only in our server’s
            environment — never in the database, never in logs, never sent to your browser.
          </p>
        </section>

        <section className="pv-section">
          <h2>
            <ShieldIcon width={18} height={18} /> What we can and cannot see — honestly
          </h2>
          <p>
            We will not pretend to be zero-knowledge. Because background jobs (uploads, syncs) must
            run while you are logged out, our server can technically decrypt your connection key to
            do that work. What this means in practice:
          </p>
          <ul>
            <li>
              <strong>We never store your files.</strong> File bytes stream through our server to
              your storage and back — they are never written to our disks or database.
            </li>
            <li>
              <strong>We never read your messages or contact anyone</strong> on your connected
              account. The access is used solely to manage your private storage channel.
            </li>
            <li>
              A future opt-in <em>“paranoid mode”</em> will derive the key from your password so
              even we cannot decrypt it — at the cost of background syncing. It is on the roadmap.
            </li>
          </ul>
        </section>

        <section className="pv-section">
          <h2>Risks we want you to know</h2>
          <ul>
            <li>
              <strong>Inactivity deletion:</strong> the storage platform deletes accounts left
              inactive (6 months by default). If that happens, the files stored there are gone. Keep
              the account alive, or keep backups of anything irreplaceable.
            </li>
            <li>
              <strong>Not end-to-end encrypted by the platform:</strong> files are encrypted in
              transit, but the storage platform itself can technically access them under its own
              terms.
            </li>
            <li>
              <strong>Terms of service:</strong> using a personal account as bulk storage sits in a
              gray area of the platform’s rules.
            </li>
          </ul>
        </section>

        <section className="pv-section">
          <h2>Operational practices</h2>
          <ul>
            <li>
              The master key supports rotation without downtime, so it can be replaced if ever
              exposed.
            </li>
            <li>Sessions, tokens, passwords, and keys are redacted from every log line.</li>
            <li>Every login, connection, and deletion is written to your own activity log.</li>
          </ul>
          <p style={{ marginTop: 'var(--pv-s4)' }}>
            <Link href="/activity">View your activity log →</Link>
          </p>
        </section>
      </article>
    </div>
  );
}
