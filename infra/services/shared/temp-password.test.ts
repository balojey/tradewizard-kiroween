import { describe, expect, it } from 'vitest';
import { generateTemporaryPassword } from './temp-password';

describe('generateTemporaryPassword', () => {
  it('produces a password that clears the pool policy', () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generateTemporaryPassword();

      expect(password).toHaveLength(20);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
    }
  });

  it('avoids ambiguous characters', () => {
    const sample = Array.from({ length: 50 }, () => generateTemporaryPassword()).join('');
    expect(sample).not.toMatch(/[IlO01]/);
  });

  it('is not predictable across calls', () => {
    const values = new Set(Array.from({ length: 100 }, () => generateTemporaryPassword()));
    expect(values.size).toBe(100);
  });

  it('refuses a length below the safety floor', () => {
    expect(() => generateTemporaryPassword(8)).toThrow();
  });

  it('honours a longer requested length', () => {
    expect(generateTemporaryPassword(32)).toHaveLength(32);
  });
});
