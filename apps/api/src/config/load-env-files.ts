import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Populate process.env from .env files BEFORE anything validates it. Parsing
 * is done with Node built-ins — no dependency in the boot path. Paths are
 * resolved from this file's location — not the working directory — so
 * `pnpm dev` behaves the same from the repo root, apps/api, and on Windows.
 *
 * Precedence: real environment > apps/api/.env > repo-root .env
 * (an already-set key is never overwritten).
 *
 * This module must stay side-effect-only and be the FIRST import of the entry
 * point. src/config and dist/config sit at the same depth, so the relative
 * hops below hold in both dev (tsx) and production builds.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

const candidates = [
  path.resolve(here, '../../.env'), // apps/api/.env (package-local override)
  path.resolve(here, '../../../../.env'), // repo root .env (the documented default)
];

for (const file of candidates) {
  if (existsSync(file)) {
    applyEnvFile(file);
  }
}

function applyEnvFile(file: string): void {
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const withoutExport = line.startsWith('export ') ? line.slice('export '.length) : line;
    const separator = withoutExport.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = withoutExport.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = withoutExport.slice(separator + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      // Unquoted values may carry a trailing inline comment.
      const comment = value.indexOf(' #');
      if (comment !== -1) {
        value = value.slice(0, comment).trim();
      }
    }

    process.env[key] = value;
  }
}
