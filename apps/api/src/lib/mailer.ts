import type { Logger } from 'pino';
import { maskEmail } from './mask.js';

export interface PasswordResetMail {
  /** Who the reset is for — the identifier logs use to refer to them. */
  userId: string;
  /** The account's email address; the reset link is only ever sent there. */
  email: string;
  resetUrl: string;
}

export interface Mailer {
  /** Sends the password-reset link. Must never throw into the request path. */
  sendPasswordReset(mail: PasswordResetMail): Promise<void>;
}

/**
 * Outbound email. With RESEND_API_KEY + MAIL_FROM configured it sends through
 * Resend's plain HTTP API (free tier, no SDK dependency).
 *
 * Every attempt writes exactly one log line with `event: 'mail.password_reset'`
 * and an `outcome`, so you can tell from production logs whether email works:
 *   sent | rejected | failed | not_configured
 *
 * Privacy: logs name the person by `userId` (look the address up in the
 * database if you need it) plus a masked address (`sh***@g***.com`). The full
 * address and the reset link are never logged in production — the link is a
 * live credential that would let anyone who can read the logs take over the
 * account. Only in local development (`logResetLinks`) is the link logged, so
 * the flow is testable without an email provider.
 */
export function createMailer(
  config: { resendApiKey?: string; mailFrom?: string; logResetLinks?: boolean },
  logger: Logger,
): Mailer {
  const { resendApiKey, mailFrom, logResetLinks = false } = config;

  return {
    async sendPasswordReset({ userId, email, resetUrl }) {
      const log = { event: 'mail.password_reset', userId, to: maskEmail(email) };

      if (!resendApiKey || !mailFrom) {
        if (logResetLinks) {
          logger.warn(
            { ...log, outcome: 'not_configured', resetUrl },
            'Email is not configured (RESEND_API_KEY/MAIL_FROM) — password reset link logged instead of sent',
          );
        } else {
          logger.error(
            { ...log, outcome: 'not_configured' },
            'Email is not configured (RESEND_API_KEY/MAIL_FROM) — password reset email NOT sent',
          );
        }
        return;
      }

      const started = Date.now();
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: mailFrom,
            to: [email],
            subject: 'Reset your Pocketverse password',
            text: [
              'Someone (hopefully you) asked to reset the password for this Pocketverse account.',
              '',
              `Reset it here (link valid for 30 minutes): ${resetUrl}`,
              '',
              "If this wasn't you, you can ignore this email — nothing changes without the link.",
            ].join('\n'),
          }),
        });
        const ms = Date.now() - started;
        if (!res.ok) {
          // The body carries the actual reason — most often an unverified
          // `from` domain or a bad key. The endpoint deliberately still reports
          // success to the caller (no account probing), so this log is the
          // only place a failure surfaces.
          const detail = await res.text().catch(() => '');
          logger.error(
            {
              ...log,
              outcome: 'rejected',
              status: res.status,
              detail: detail.slice(0, 500),
              from: mailFrom,
              ms,
            },
            'Password reset email rejected by Resend — check MAIL_FROM is on a verified domain and RESEND_API_KEY is valid',
          );
          return;
        }
        // Resend's message id — search it in the Resend dashboard (Emails) to
        // see whether the message was delivered, bounced or marked as spam.
        const body = (await res.json().catch(() => ({}))) as { id?: string };
        logger.info(
          { ...log, outcome: 'sent', resendId: body.id, ms },
          'Password reset email accepted by Resend',
        );
      } catch (error) {
        logger.error(
          { ...log, outcome: 'failed', err: error, ms: Date.now() - started },
          'Password reset email failed to send (network error reaching Resend)',
        );
      }
    },
  };
}
