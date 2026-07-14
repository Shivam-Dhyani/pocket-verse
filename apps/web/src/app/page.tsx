import Link from 'next/link';
import { AuthForward } from '@/components/auth-forward';
import { LinkedInIcon, LockIcon, OrbitLogo, ShieldIcon, UploadPortal } from '@/components/icons';
import { CREATOR } from '@/lib/creator';

export default function LandingPage() {
  return (
    <main className="pv-hero">
      <AuthForward />
      <span className="pv-brand">
        <OrbitLogo width={24} height={24} /> Pocketverse
      </span>
      <h1>A whole universe in your pocket.</h1>
      <p>
        Unlimited storage for your files — kept in storage you control, with encrypted connections
        and no surprises. We tell you exactly where everything lives.
      </p>
      <div className="pv-hero-actions">
        <Link href="/register">
          <button className="pv-button" type="button">
            Create your account
          </button>
        </Link>
        <Link href="/login">
          <button className="pv-button pv-button--ghost" type="button">
            Sign in
          </button>
        </Link>
      </div>

      <div className="pv-hero-points">
        <div className="pv-card">
          <LockIcon />
          <h3>Encrypted at rest</h3>
          <p>Your storage connection is sealed with AES-256-GCM and never leaves our vault.</p>
        </div>
        <div className="pv-card">
          <UploadPortal />
          <h3>Unlimited, and truly yours</h3>
          <p>
            No quotas, no tiers — files stream to storage you own. We keep only the map, never the
            bytes.
          </p>
        </div>
        <div className="pv-card">
          <ShieldIcon />
          <h3>Honest by design</h3>
          <p>Real progress, plain-language risks, and an activity log you can read.</p>
        </div>
      </div>

      <footer className="pv-made-by">
        Crafted by{' '}
        <a href={CREATOR.linkedin} target="_blank" rel="noopener noreferrer">
          {CREATOR.name} <LinkedInIcon width={14} height={14} />
        </a>
      </footer>
    </main>
  );
}
