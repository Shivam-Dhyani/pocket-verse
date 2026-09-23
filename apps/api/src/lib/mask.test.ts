import { describe, expect, it } from 'vitest';
import { maskEmail } from './mask.js';

describe('maskEmail', () => {
  it('keeps only a hint of the local part and domain', () => {
    expect(maskEmail('shivam.dhyani@gmail.com')).toBe('sh***@g***.com');
    expect(maskEmail('a@example.co.uk')).toBe('a***@e***.uk');
    expect(maskEmail('ab@x.io')).toBe('a***@x***.io');
  });

  it('never returns the original address', () => {
    const email = 'jane.doe@company.com';
    const masked = maskEmail(email);
    expect(masked).not.toContain('jane.doe');
    expect(masked).not.toContain('company');
  });

  it('handles malformed input', () => {
    expect(maskEmail('not-an-email')).toBe('***');
    expect(maskEmail('@nolocal.com')).toBe('***');
  });
});
