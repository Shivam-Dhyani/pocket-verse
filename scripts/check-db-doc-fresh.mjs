#!/usr/bin/env node
/**
 * Staleness guard for docs/DATABASE.md.
 *
 * If a commit stages a change to the Prisma schema or any API route/service
 * (the things docs/DATABASE.md documents) WITHOUT also staging the doc, warn
 * loudly so the doc never drifts from the code. Non-blocking by default — it
 * reminds rather than rejects; pass --strict (or set DB_DOC_STRICT=1) to make
 * it fail the commit instead.
 *
 * Wired into pre-commit and available as `pnpm docs:check-db`.
 */
import { execSync } from 'node:child_process';

const DOC = 'docs/DATABASE.md';

// Paths whose changes must be mirrored in the doc.
const WATCHED = [
  /^apps\/api\/prisma\/schema\.prisma$/,
  /^apps\/api\/prisma\/migrations\//,
  /^apps\/api\/src\/modules\/.*\.routes\.ts$/,
  /^apps\/api\/src\/modules\/.*\.service\.ts$/,
  /^apps\/api\/src\/app\.ts$/,
];

function stagedFiles() {
  try {
    return execSync('git diff --cached --name-only', { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const staged = stagedFiles();
const touchedBackend = staged.filter((file) => WATCHED.some((re) => re.test(file)));
const docStaged = staged.includes(DOC);

if (touchedBackend.length > 0 && !docStaged) {
  const strict = process.argv.includes('--strict') || process.env.DB_DOC_STRICT === '1';
  const bar = '─'.repeat(64);
  const lines = [
    '',
    bar,
    '⚠️  Backend changed but docs/DATABASE.md was NOT updated.',
    '',
    'These staged files affect the data model / API surface:',
    ...touchedBackend.map((file) => `   • ${file}`),
    '',
    `Update ${DOC} so the table↔endpoint map stays accurate`,
    '(run the `db-architecture-doc` skill, or edit it by hand), then',
    'stage it. See the doc footer for the procedure.',
    bar,
    '',
  ];
  console.error(lines.join('\n'));
  if (strict) {
    process.exit(1);
  }
}
