'use client';

import Link from 'next/link';
import { AppHeader } from '@/components/app-header';
import { ConnectionManager } from '@/components/connection-manager';
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

        <ConnectionManager />

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
          <h2>Telegram-powered storage: what “unlimited” really means</h2>
          <p>
            Your files live in a private channel inside <strong>your own Telegram account</strong>.
            Telegram places no cap on how much a channel can hold — that is why your Pocketverse
            space is genuinely unlimited: it is Telegram’s storage, and you own the account it lives
            in. Telegram does limit a <em>single</em> upload to 2&nbsp;GB, so Pocketverse quietly
            splits bigger files into parts and reassembles them when you download — large files
            simply take longer, they are never rejected.
          </p>

          <h3 style={{ marginTop: 'var(--pv-s5)' }}>
            When files can be lost (and how to prevent it)
          </h3>
          <p>
            Apart from you deleting things inside Pocketverse, there are exactly three ways data can
            disappear. Each one is preventable, and whenever Pocketverse detects a loss it writes it
            to your <Link href="/activity">activity log</Link> so you always know what happened and
            when.
          </p>
          <ul>
            <li>
              <strong>Telegram’s inactivity rule.</strong> Telegram deletes accounts that stay away
              too long — <em>6 months by default</em> — and a deleted account takes its channels and
              files with it. Do this once, today: in Telegram open{' '}
              <em>Settings → Privacy and Security → Delete my account → If away for</em> and set it
              to <strong>12 months</strong>. Using Telegram or Pocketverse from time to time also
              counts as activity.
            </li>
            <li>
              <strong>Disconnecting your Telegram account from Pocketverse.</strong> Disconnecting
              removes our access, so Pocketverse clears its listing of your files — the files
              themselves remain in your “Pocketverse Storage” channel, but the app can no longer
              show or download them, and reconnecting starts with an empty drive. Download anything
              you still need <em>before</em> you disconnect. What was cleared is recorded in your
              activity log.
            </li>
            <li>
              <strong>Touching the storage channel by hand.</strong> If you delete messages from the
              “Pocketverse Storage” channel in the Telegram app — or delete the channel itself —
              those files are gone for good. Treat that channel as machine-managed: don’t delete
              from it manually. If Pocketverse finds a file’s data missing, it marks the file as
              lost and records it in your activity log.
            </li>
          </ul>

          <h3 style={{ marginTop: 'var(--pv-s5)' }}>Two more things to know</h3>
          <ul>
            <li>
              <strong>Not end-to-end encrypted by Telegram:</strong> files are encrypted in transit,
              but Telegram itself can technically access channel content under its own terms.
            </li>
            <li>
              <strong>Terms of service:</strong> using a personal account as bulk file storage sits
              in a gray area of Telegram’s rules. We believe personal use is reasonable, but it is
              your account — we want you deciding with open eyes.
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
