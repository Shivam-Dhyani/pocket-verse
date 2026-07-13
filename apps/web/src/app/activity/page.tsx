'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import type { ActivityPage } from '@pocketverse/shared';
import { request } from '@/lib/api';
import { AppHeader } from '@/components/app-header';
import { ActivityIcon } from '@/components/icons';
import { EmptyState, timeAgo } from '@/components/ui';

/** Human labels for the audit event types recorded since Phase 2. */
function describe(type: string, metadata: Record<string, unknown> | null): string {
  const name = typeof metadata?.name === 'string' ? `“${metadata.name}”` : '';
  switch (type) {
    case 'auth.register':
      return 'Created your account';
    case 'auth.login':
      return 'Signed in';
    case 'auth.password_changed':
      return 'Changed your password (other devices were signed out)';
    case 'auth.password_reset_requested':
      return 'Requested a password reset link';
    case 'auth.password_reset':
      return 'Reset your password (all devices were signed out)';
    case 'connection.started':
      return 'Started connecting your storage';
    case 'connection.connected':
      return 'Connected your storage';
    case 'connection.disconnected':
      return 'Disconnected your storage';
    case 'connection.health_failed':
      return 'Storage connection check failed';
    case 'connection.session_revoked':
      return 'Pocketverse’s session was ended from inside Telegram — reconnect to resume syncing';
    case 'file.uploaded':
      return `Uploaded ${name || 'a file'}`;
    case 'file.upload_failed':
      return `Upload failed for ${name || 'a file'}`;
    case 'file.deleted':
      return `Deleted ${name || 'a file'}`;
    case 'folder.deleted':
      return 'Deleted a folder';
    case 'drive.index_cleared': {
      const files = typeof metadata?.files === 'number' ? metadata.files : 0;
      const folders = typeof metadata?.folders === 'number' ? metadata.folders : 0;
      return `Disconnecting cleared your drive listing — ${files} ${files === 1 ? 'file' : 'files'} and ${folders} ${folders === 1 ? 'folder' : 'folders'} are no longer tracked here (the files themselves stay in your storage channel)`;
    }
    case 'file.unreachable':
      return `${name || 'A file'} could not be read from your storage — it looks like it was deleted there, so it is marked as lost`;
    default:
      return type;
  }
}

export default function ActivityPage() {
  const query = useInfiniteQuery({
    queryKey: ['activity'],
    queryFn: ({ pageParam }) =>
      request<ActivityPage>(`/api/activity${pageParam ? `?cursor=${pageParam}` : ''}`, {
        auth: true,
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const events = query.data?.pages.flatMap((page) => page.events) ?? [];

  return (
    <div className="pv-app">
      <AppHeader />
      <article className="pv-page">
        <h1>Activity</h1>
        <p className="pv-sub">
          Everything that has happened on your account. Only you can see this.
        </p>

        {query.isPending ? (
          <p className="pv-footnote">
            <span className="pv-spinner" /> Loading…
          </p>
        ) : events.length === 0 ? (
          <EmptyState icon={<ActivityIcon width={40} height={40} />} title="No activity yet" />
        ) : (
          <>
            <ul className="pv-timeline">
              {events.map((event) => (
                <li key={event.id}>
                  <span className="pv-row-icon">
                    <ActivityIcon width={16} height={16} />
                  </span>
                  {describe(event.type, event.metadata)}
                  <span className="when">{timeAgo(event.createdAt)}</span>
                </li>
              ))}
            </ul>
            {query.hasNextPage && (
              <div style={{ textAlign: 'center', marginTop: 'var(--pv-s5)' }}>
                <button
                  className="pv-button pv-button--ghost"
                  type="button"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </article>
    </div>
  );
}
