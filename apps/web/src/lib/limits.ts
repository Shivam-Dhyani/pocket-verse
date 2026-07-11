/**
 * Product guardrails for folder uploads, expressed as a number of files in a
 * single upload. File *count* — not total size — is the real constraint: each
 * file becomes its own storage operation on the user's single account, which
 * serializes upstream and is rate-limited, so many tiny files (not a few big
 * ones) is what hurts.
 *
 * These are deliberately conservative defaults for a free-tier deployment and
 * are overridable per environment (no code change needed) so they can be tuned
 * once real capacity is measured.
 */
function envInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Above this, we warn the user it's a large upload but let them proceed. */
export const UPLOAD_WARN_FILE_COUNT = envInt(process.env.NEXT_PUBLIC_UPLOAD_WARN_FILE_COUNT, 500);

/**
 * Above this, a single upload is too much to land reliably in one go. We don't
 * dead-end the user — we ask them to split it into smaller batches instead.
 */
export const UPLOAD_MAX_FILE_COUNT = envInt(process.env.NEXT_PUBLIC_UPLOAD_MAX_FILE_COUNT, 2000);

/** A friendly, concrete batch size to suggest when a folder is over the max. */
export const UPLOAD_SUGGESTED_BATCH = envInt(process.env.NEXT_PUBLIC_UPLOAD_SUGGESTED_BATCH, 300);
