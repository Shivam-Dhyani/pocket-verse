import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Populate process.env from .env files BEFORE anything validates it. Paths are
 * resolved from this file's location — not the working directory — so
 * `pnpm dev` behaves the same from the repo root, apps/api, and on Windows.
 *
 * Precedence: real environment > apps/api/.env > repo-root .env
 * (dotenv never overwrites keys that are already set).
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
    dotenv.config({ path: file });
  }
}
