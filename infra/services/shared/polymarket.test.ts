import { describe, expect, it } from 'vitest';
import {
  isYesOutcome,
  selectYesTokenId,
  yesProbabilityFromOutcomes,
} from './polymarket';

describe('selectYesTokenId', () => {
  it('selects the token labelled YES regardless of array order', () => {
    const tokens = [
      { token_id: 'no-token', outcome: 'No' },
      { token_id: 'yes-token', outcome: 'Yes' },
    ];

    expect(selectYesTokenId(tokens)).toBe('yes-token');
  });

  it('handles casing and whitespace in the outcome label', () => {
    expect(
      selectYesTokenId([{ token_id: 'yes-token', outcome: '  yEs  ' }]),
    ).toBe('yes-token');
  });

  it('falls back to the first token only when outcomes are unlabelled', () => {
    expect(selectYesTokenId([{ token_id: 'first' }, { token_id: 'second' }])).toBe(
      'first',
    );
  });

  it('never treats an explicitly-labelled NO token as YES', () => {
    expect(selectYesTokenId([{ token_id: 'no-token', outcome: 'No' }])).toBe('');
  });

  it('returns an empty string for malformed input', () => {
    expect(selectYesTokenId(undefined)).toBe('');
    expect(selectYesTokenId([])).toBe('');
    expect(selectYesTokenId([{ outcome: 'Yes' }])).toBe('');
  });
});

describe('yesProbabilityFromOutcomes', () => {
  it('resolves YES by label when the arrays are Yes/No ordered', () => {
    expect(
      yesProbabilityFromOutcomes('["Yes","No"]', '["0.68","0.32"]'),
    ).toBeCloseTo(0.68, 6);
  });

  it('resolves YES by label when the arrays are No/Yes ordered', () => {
    expect(
      yesProbabilityFromOutcomes('["No","Yes"]', '["0.31","0.69"]'),
    ).toBeCloseTo(0.69, 6);
  });

  it('accepts already-parsed arrays', () => {
    expect(
      yesProbabilityFromOutcomes(['Yes', 'No'], [0.4, 0.6]),
    ).toBeCloseTo(0.4, 6);
  });

  it('falls back to the first price when outcomes are missing', () => {
    expect(yesProbabilityFromOutcomes(undefined, '["0.55","0.45"]')).toBeCloseTo(
      0.55,
      6,
    );
  });

  it('returns null for unusable prices', () => {
    expect(yesProbabilityFromOutcomes('["Yes","No"]', '[]')).toBeNull();
    expect(yesProbabilityFromOutcomes('["Yes","No"]', '["abc","0.4"]')).toBeNull();
  });
});

describe('isYesOutcome', () => {
  it('recognises only the YES label', () => {
    expect(isYesOutcome('Yes')).toBe(true);
    expect(isYesOutcome(' yes ')).toBe(true);
    expect(isYesOutcome('No')).toBe(false);
    expect(isYesOutcome(undefined)).toBe(false);
  });
});
