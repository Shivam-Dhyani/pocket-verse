import type { Logger } from 'pino';

export interface Mailer {
  /** Sends the password-reset link. Must never throw into the request path. */
  sendPasswordReset(email: string, resetUrl: string): Promise<void>;
}

/**
 * Outbound email. With RESEND_API_KEY + MAIL_FROM configured it sends through
 * Resend's plain HTTP API (free tier, no SDK dependency). Without them —
 * typical for local development — the reset link is logged instead, clearly
 * marked, so the flow stays fully testable end to end.
 */
export function createMailer(
  config: { resendApiKey?: string; mailFrom?: string },
  logger: Logger,
): Mailer {
  const { resendApiKey, mailFrom } = config;

  return {
    async sendPasswordReset(email, resetUrl) {
      if (!resendApiKey || !mailFrom) {
        // Dev fallback: the URL contains the one-time token; this log level is
        // for local runs and the message says exactly what it is.
        logger.warn(
          { email, resetUrl },
          'Email is not configured (RESEND_API_KEY/MAIL_FROM) — password reset link logged instead of sent',
        );
        return;
      }
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
        if (!res.ok) {
          logger.error({ status: res.status }, 'Password reset email failed to send');
        }
      } catch (error) {
        logger.error({ err: error }, 'Password reset email failed to send');
      }
    },
  };
}
