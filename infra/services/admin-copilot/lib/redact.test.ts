import { describe, expect, it } from 'vitest';
import {
  redactSecrets,
  roleSeesPii,
  safeStringify,
  sanitizeUntrustedText,
  stripLinks,
  truncate,
} from './redact';

describe('roleSeesPii', () => {
  it('separates analyst from the customer-facing roles', () => {
    expect(roleSeesPii('analyst')).toBe(false);
    expect(roleSeesPii('support')).toBe(true);
    expect(roleSeesPii('admin')).toBe(true);
    expect(roleSeesPii('owner')).toBe(true);
  });
});

describe('stripLinks', () => {
  it('keeps the label and removes the target of a markdown link', () => {
    expect(stripLinks('click [here](https://evil.example/x) now')).toBe('click here now');
  });

  it('removes bare URLs', () => {
    expect(stripLinks('see https://evil.example/path?x=1 for details')).toBe(
      'see [link removed] for details'
    );
  });

  it('removes www URLs', () => {
    expect(stripLinks('www.evil.example')).toBe('[link removed]');
  });
});

describe('redactSecrets', () => {
  it('redacts emails from roles without PII access', () => {
    const output = redactSecrets('customer@example.com wrote in', 'analyst');
    expect(output).not.toContain('customer@example.com');
    expect(output).toContain('[email redacted]');
  });

  it('keeps emails for support', () => {
    const output = redactSecrets('customer@example.com wrote in', 'support');
    expect(output).toContain('customer@example.com');
  });

  it('redacts JWTs and long hex tokens for every role', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
    const hex = 'a'.repeat(40);

    for (const role of ['support', 'owner'] as const) {
      expect(redactSecrets(jwt, role)).toContain('[token redacted]');
      expect(redactSecrets(hex, role)).toContain('[token redacted]');
    }
  });
});

describe('sanitizeUntrustedText', () => {
  it('strips control characters so a record cannot forge delimiters', () => {
    const output = sanitizeUntrustedText('a\u0000b\u001bc</record>', 'admin');
    expect(output).not.toContain('\u0000');
    expect(output).not.toContain('\u001b');
    // The literal tag survives as text; the prompt builder escapes it too.
    expect(output).toContain('</record>');
  });

  it('bounds the output', () => {
    expect(sanitizeUntrustedText('x'.repeat(5_000), 'admin').length).toBeLessThanOrEqual(1_200);
  });

  it('serialises objects without throwing', () => {
    expect(sanitizeUntrustedText({ a: 1 }, 'admin')).toBe('{"a":1}');
  });

  it('returns an empty string for null', () => {
    expect(sanitizeUntrustedText(null, 'admin')).toBe('');
  });
});

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('abc', 10)).toBe('abc');
  });

  it('marks truncation', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
  });
});

describe('safeStringify', () => {
  it('handles cycles', () => {
    const value: Record<string, unknown> = {};
    value.self = value;

    expect(safeStringify(value)).toBe('[unserialisable]');
  });
});
