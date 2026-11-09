import { describe, expect, it } from 'vitest';
import {
  readPersonaParamsFor,
  writePersonaParamsFor,
} from './persona-registry';

describe('readPersonaParamsFor', () => {
  it('reads the params stored for the requested persona', () => {
    const stored = {
      sniper: { exitSensitivity: 5 },
      scalper: { positionSizingMultiplier: 1.5 },
    };

    expect(readPersonaParamsFor('sniper', stored)).toEqual({ exitSensitivity: 5 });
    expect(readPersonaParamsFor('scalper', stored)).toEqual({
      positionSizingMultiplier: 1.5,
    });
  });

  it('returns undefined for a persona without customization', () => {
    expect(readPersonaParamsFor('contrarian', { sniper: { exitSensitivity: 5 } })).toBeUndefined();
    expect(readPersonaParamsFor('sniper', null)).toBeUndefined();
    expect(readPersonaParamsFor('sniper', undefined)).toBeUndefined();
  });

  it('treats legacy flat rows as applying to any persona', () => {
    // Rows written before per-market personas held a single flat object.
    const legacy = { exitSensitivity: 4, monitoringFrequencyMinutes: 15 };

    expect(readPersonaParamsFor('sniper', legacy)).toEqual(legacy);
    expect(readPersonaParamsFor('scalper', JSON.stringify(legacy))).toEqual(legacy);
  });

  it('survives malformed JSON instead of throwing', () => {
    expect(readPersonaParamsFor('sniper', 'not json')).toBeUndefined();
  });
});

describe('writePersonaParamsFor', () => {
  it('preserves other personas tuning', () => {
    const stored = { sniper: { exitSensitivity: 5 } };

    const next = writePersonaParamsFor(stored, 'scalper', {
      positionSizingMultiplier: 0.8,
    });

    expect(next.sniper).toEqual({ exitSensitivity: 5 });
    expect(next.scalper).toEqual({ positionSizingMultiplier: 0.8 });
  });

  it('keeps legacy flat rows with the persona they were written for', () => {
    const next = writePersonaParamsFor(
      { exitSensitivity: 4 },
      'sniper',
      { exitSensitivity: 3 }
    );

    expect(next).toEqual({ sniper: { exitSensitivity: 3 } });
  });

  it('creates a store from null', () => {
    expect(writePersonaParamsFor(null, 'sniper', { exitSensitivity: 2 })).toEqual({
      sniper: { exitSensitivity: 2 },
    });
  });
});
