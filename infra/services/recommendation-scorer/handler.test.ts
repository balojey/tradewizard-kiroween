import { describe, expect, it } from 'vitest';
import { classifyOutcomeHit } from './handler';

describe('classifyOutcomeHit', () => {
  it('returns pending while price sits between the stop and the target', () => {
    expect(classifyOutcomeHit(0.55, 0.7, 0.4)).toBe('pending');
  });

  it('returns success when the target is reached', () => {
    expect(classifyOutcomeHit(0.7, 0.7, 0.4)).toBe('success');
  });

  it('returns failure when the stop is hit', () => {
    expect(classifyOutcomeHit(0.4, 0.7, 0.4)).toBe('failure');
  });

  it('books malformed overlapping levels as a failure', () => {
    // target <= stop can only come from bad data; never book that as a win.
    expect(classifyOutcomeHit(0.55, 0.4, 0.7)).toBe('failure');
  });
});
