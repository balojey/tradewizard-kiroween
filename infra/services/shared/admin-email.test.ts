import { describe, expect, it } from 'vitest';
import {
  AdminEmailError,
  isAdminAlias,
  toAdminEmail,
} from './admin-email';

describe('toAdminEmail', () => {
  it('appends +warden to a plain customer address', () => {
    expect(toAdminEmail('azeezbalogun74@gmail.com')).toEqual({
      original: 'azeezbalogun74@gmail.com',
      adminEmail: 'azeezbalogun74+warden@gmail.com',
      changed: true,
    });
  });

  it('is idempotent for an already-aliased address', () => {
    const once = toAdminEmail('azeezbalogun74@gmail.com');
    const twice = toAdminEmail(once.adminEmail);

    expect(twice.adminEmail).toBe(once.adminEmail);
    expect(twice.changed).toBe(false);
  });

  it('lowercases the address so one mailbox cannot become two identities', () => {
    expect(toAdminEmail('Azeez.Balogun@Gmail.COM').adminEmail).toBe(
      'azeez.balogun+warden@gmail.com'
    );
  });

  it('treats an uppercase tag as already aliased', () => {
    const result = toAdminEmail('Azeez+WARDEN@Gmail.com');
    expect(result.adminEmail).toBe('azeez+warden@gmail.com');
    expect(result.changed).toBe(false);
  });

  it('keeps an existing plus-tag and appends after it', () => {
    // Stripping someone's own tag could reroute their mail on servers where the
    // tag is meaningful, so we add rather than replace.
    expect(toAdminEmail('john+work@corp.example').adminEmail).toBe(
      'john+work+warden@corp.example'
    );
  });

  it('handles subdomains', () => {
    expect(toAdminEmail('ops@mail.corp.example.com').adminEmail).toBe(
      'ops+warden@mail.corp.example.com'
    );
  });

  it('splits on the last @ in a quoted-looking local part', () => {
    expect(toAdminEmail('team+ops@tradewizard.live').adminEmail).toBe(
      'team+ops+warden@tradewizard.live'
    );
  });

  it('trims surrounding whitespace', () => {
    expect(toAdminEmail('  person@example.com  ')).toMatchObject({
      original: 'person@example.com',
      adminEmail: 'person+warden@example.com',
    });
  });

  it('accepts a local part at the length limit', () => {
    const local = 'a'.repeat(64);
    expect(toAdminEmail(`${local}@example.com`).adminEmail).toBe(
      `${local}+warden@example.com`
    );
  });

  it('rejects an address whose alias would exceed the RFC limit', () => {
    const local = 'a'.repeat(64);
    const domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.com`;
    expect(() => toAdminEmail(`${local}@${domain}`)).toThrow(AdminEmailError);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['not-an-email', 'no @'],
    ['@example.com', 'empty local part'],
    ['person@', 'empty domain'],
    ['person@localhost', 'no dot in domain'],
    ['per son@example.com', 'space'],
    ['person@exa mple.com', 'space in domain'],
    ['.person@example.com', 'leading dot'],
    ['person.@example.com', 'trailing dot'],
    ['per..son@example.com', 'double dot'],
    ['person@.example.com', 'leading dot in domain'],
    ['person@example.com.', 'trailing dot in domain'],
    ['person@example..com', 'double dot in domain'],
  ])('rejects %j (%s)', (input) => {
    expect(() => toAdminEmail(input)).toThrow(AdminEmailError);
  });

  it('rejects non-string input', () => {
    expect(() => toAdminEmail(undefined)).toThrow(AdminEmailError);
    expect(() => toAdminEmail(null)).toThrow(AdminEmailError);
    expect(() => toAdminEmail(42)).toThrow(AdminEmailError);
  });
});

describe('isAdminAlias', () => {
  it('detects the tag case-insensitively', () => {
    expect(isAdminAlias('person+warden@example.com')).toBe(true);
    expect(isAdminAlias('person+WARDEN@example.com')).toBe(true);
  });

  it('is false for plain addresses and other tags', () => {
    expect(isAdminAlias('person@example.com')).toBe(false);
    expect(isAdminAlias('person+work@example.com')).toBe(false);
    expect(isAdminAlias('not-an-email')).toBe(false);
  });
});
