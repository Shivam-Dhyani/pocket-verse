/**
 * Masks an email address for logs: enough to tell addresses apart and spot a
 * typo'd or unusual domain, never enough to recover the address.
 *
 *   shivam.dhyani@gmail.com  →  sh***@g***.com
 *   a@example.co.uk          →  a***@e***.uk
 *
 * Logs should identify people by `userId`; this is only a human-readable hint
 * next to it (and the only identifier for requests with no account).
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) {
    return '***';
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot > 0 ? domain.slice(dot) : '';
  const name = dot > 0 ? domain.slice(0, dot) : domain;
  return `${local.slice(0, local.length > 2 ? 2 : 1)}***@${name.slice(0, 1)}***${tld}`;
}
