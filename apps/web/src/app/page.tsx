import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="pv-hero">
      <span className="pv-brand">Pocketverse</span>
      <h1>A whole universe in your pocket.</h1>
      <p>
        A calm, familiar home for your files — kept in storage you control, encrypted connections,
        no surprises. We tell you exactly where everything lives.
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
    </main>
  );
}
