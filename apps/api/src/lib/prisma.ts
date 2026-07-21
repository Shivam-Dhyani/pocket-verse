import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;

/**
 * Force a Postgres statement_timeout so no single query can ever hang the
 * process indefinitely (a runaway query becomes a fast, honest error instead
 * of a request stuck "pending" for minutes). Applied via the connection URL's
 * libpq `options` param unless the operator already set one.
 */
function withStatementTimeout(url: string | undefined, ms = 30_000): string | undefined {
  if (!url || url.includes('statement_timeout')) {
    return url;
  }
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('options', `-c statement_timeout=${ms}`);
    return parsed.toString();
  } catch {
    return url; // non-standard URL — leave it untouched
  }
}

export function getPrisma(): PrismaClient {
  client ??= new PrismaClient({
    datasources: { db: { url: withStatementTimeout(process.env.DATABASE_URL) } },
  });
  return client;
}
