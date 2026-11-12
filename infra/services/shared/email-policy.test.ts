import { describe, expect, it } from 'vitest';
import { hasPlusTag, PLUS_TAG_MESSAGE } from './email-policy';

describe('hasPlusTag', () => {
  it.each([
    'person+warden@example.com',
    'azeezbalogun74+admin@gmail.com',
    'john+work@corp.example',
    'person+tag+another@example.com',
    '  spaced+tag@example.com  ',
  ])('detects a tag in %j', (email) => {
    expect(hasPlusTag(email)).toBe(true);
  });

  it.each([
    'person@example.com',
    'azeezbalogun74@gmail.com',
    'first.last@example.com',
    'person@plus+domain.example',
    'not-an-email',
    '',
  ])('allows %j', (email) => {
    expect(hasPlusTag(email)).toBe(false);
  });

  it('does not treat a plus in the domain as a tag', () => {
    // Domains cannot contain '+', but if a malformed one does, the local part is
    // what the rule is about.
    expect(hasPlusTag('person@exa+mple.com')).toBe(false);
  });

  it('explains the rule without mentioning the operations portal', () => {
    expect(PLUS_TAG_MESSAGE).not.toMatch(/warden|admin|portal/i);
  });
});
