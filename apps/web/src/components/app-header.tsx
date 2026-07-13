'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StatsDto } from '@pocketverse/shared';
import { api, request } from '@/lib/api';
import { ActivityIcon, InfoIcon, OrbitLogo, ShieldIcon } from '@/components/icons';
import { ThemeToggle } from '@/components/theme-toggle';
import { useDialogs } from '@/components/dialogs';
import { formatSize } from '@/components/ui';
import { useAuthStore } from '@/stores/auth';

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const dialogs = useDialogs();
  const clearSession = useAuthStore((state) => state.clearSession);
  const accessToken = useAuthStore((state) => state.accessToken);
  const [signingOut, setSigningOut] = useState(false);
  // The nav icon for the page you're on gets the active treatment.
  const navClass = (href: string) => `pv-iconbtn${pathname === href ? ' pv-nav-active' : ''}`;

  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => request<StatsDto>('/api/stats', { auth: true }),
    enabled: Boolean(accessToken),
    refetchInterval: 30_000,
  });

  return (
    <header className="pv-appbar">
      <Link href="/drive" className="pv-brand">
        <OrbitLogo width={22} height={22} /> Pocketverse
      </Link>
      {children}
      <span className="pv-appbar-spacer" />
      {stats.data && (
        <span className="pv-stats-chip">
          {stats.data.files} files · {formatSize(stats.data.totalBytes)}
          {stats.data.syncingCount > 0 && ` · ${stats.data.syncingCount} syncing`}
        </span>
      )}
      <nav>
        <Link
          href="/about"
          className={navClass('/about')}
          title="About Pocketverse"
          aria-label="About"
        >
          <InfoIcon />
        </Link>
        <Link
          href="/security"
          className={navClass('/security')}
          title="Security"
          aria-label="Security"
        >
          <ShieldIcon />
        </Link>
        <Link
          href="/activity"
          className={navClass('/activity')}
          title="Activity"
          aria-label="Activity"
        >
          <ActivityIcon />
        </Link>
        <ThemeToggle />
        <button
          className="pv-iconbtn"
          type="button"
          title="Sign out"
          aria-label="Sign out"
          disabled={signingOut}
          style={{ width: 'auto', paddingInline: 10, fontSize: 'var(--pv-text-xs)' }}
          onClick={() => {
            void dialogs
              .confirm({
                title: 'Sign out of Pocketverse?',
                message:
                  'Your files stay safe and synced — signing out only ends this session on this device. Sign back in anytime to pick up where you left off.',
                confirmLabel: 'Sign out',
                cancelLabel: 'Stay signed in',
                danger: true,
              })
              .then((ok) => {
                if (!ok) {
                  return;
                }
                setSigningOut(true);
                return api
                  .logout()
                  .catch(() => undefined)
                  .then(() => {
                    clearSession();
                    router.replace('/');
                  });
              });
          }}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </nav>
    </header>
  );
}
