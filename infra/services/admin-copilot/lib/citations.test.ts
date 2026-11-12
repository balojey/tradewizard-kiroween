import { describe, expect, it } from 'vitest';
import {
  extractInlineCitations,
  lowerConfidence,
  parseModelJson,
  resolveSuggestedActions,
  reviewActions,
  validateCitations,
} from './citations';
import type { RetrievedRecord } from '../types';

const records: RetrievedRecord[] = [
  {
    type: 'audit',
    id: '11111111-1111-4111-8111-111111111111',
    label: 'settings.update by ops@example.com',
    url: '/audit?id=11111111-1111-4111-8111-111111111111',
    data: { action: 'settings.update' },
  },
  {
    type: 'analysis',
    id: '22222222-2222-4222-8222-222222222222',
    label: 'Analysis NO_TRADE',
    url: '/analyses/22222222-2222-4222-8222-222222222222',
    data: { recommendation: 'NO_TRADE' },
  },
];

describe('parseModelJson', () => {
  it('parses a bare object', () => {
    expect(parseModelJson('{"answer":"ok"}')).toMatchObject({ answer: 'ok' });
  });

  it('parses a fenced object', () => {
    const raw = '```json\n{"answer":"fenced"}\n```';
    expect(parseModelJson(raw)).toMatchObject({ answer: 'fenced' });
  });

  it('parses an object wrapped in prose', () => {
    const raw = 'Here is the answer:\n{"answer":"prose"}\nDone.';
    expect(parseModelJson(raw)).toMatchObject({ answer: 'prose' });
  });

  it('returns null for prose', () => {
    expect(parseModelJson('I cannot help with that.')).toBeNull();
  });

  it('rejects arrays', () => {
    expect(parseModelJson('[1,2,3]')).toBeNull();
  });
});

describe('validateCitations', () => {
  it('keeps citations that match a retrieved record', () => {
    const result = validateCitations(
      { answer: 'x', citations: [{ type: 'audit', id: records[0].id }] },
      'x',
      records
    );

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({
      type: 'audit',
      url: records[0].url,
      label: records[0].label,
    });
    expect(result.dropped).toEqual([]);
  });

  it('drops citations that were never retrieved', () => {
    const result = validateCitations(
      {
        answer: 'x',
        citations: [
          { type: 'audit', id: '99999999-9999-4999-8999-999999999999' },
          { type: 'audit', id: records[0].id },
        ],
      },
      'x',
      records
    );

    expect(result.citations).toHaveLength(1);
    expect(result.dropped).toEqual(['audit:99999999-9999-4999-8999-999999999999']);
  });

  it('deduplicates repeated citations', () => {
    const result = validateCitations(
      {
        answer: 'x',
        citations: [
          { type: 'audit', id: records[0].id },
          { type: 'audit', id: records[0].id },
        ],
      },
      'x',
      records
    );

    expect(result.citations).toHaveLength(1);
  });

  it('accepts inline markers only when the record exists', () => {
    const answer = `Changed [audit:${records[0].id}] and [audit:deadbeef].`;
    const result = validateCitations({ answer }, answer, records);

    expect(result.citations).toHaveLength(1);
    expect(result.unknownInline).toBe(1);
  });

  it('ignores unknown citation types', () => {
    const result = validateCitations(
      { answer: 'x', citations: [{ type: 'invoice', id: '1' }] },
      'x',
      records
    );

    expect(result.citations).toEqual([]);
    expect(result.dropped).toEqual([]);
  });
});

describe('resolveSuggestedActions', () => {
  it('takes the URL from the record, never from the model', () => {
    const actions = resolveSuggestedActions(
      {
        answer: 'x',
        suggestedActions: [{ label: 'Open the row', citationId: `audit:${records[0].id}` }],
      },
      validateCitations({ answer: 'x' }, 'x', records).citations,
      records
    );

    expect(actions[0]).toEqual({
      label: 'Open the row',
      url: records[0].url,
      kind: 'open',
    });
  });

  it('drops actions pointing at records that were not retrieved', () => {
    const actions = resolveSuggestedActions(
      {
        answer: 'x',
        suggestedActions: [{ label: 'Go here', citationId: 'audit:unknown' }],
      },
      [],
      records
    );

    // Falls back to grounded citations rather than trusting the model.
    expect(actions.every((action) => action.url.startsWith('/'))).toBe(true);
  });

  it('falls back to citing records when the model proposes nothing', () => {
    const citations = validateCitations(
      { answer: 'x', citations: [{ type: 'audit', id: records[0].id }] },
      'x',
      records
    ).citations;

    const actions = resolveSuggestedActions({ answer: 'x' }, citations, records);

    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].url).toBe(records[0].url);
  });
});

describe('reviewActions', () => {
  it('only ever returns links', () => {
    for (const kind of ['incident', 'support', 'analysis', 'risk_brief'] as const) {
      const actions = reviewActions(kind, {
        ticketId: '33333333-3333-4333-8333-333333333333',
        analysisId: records[1].id,
      });

      for (const action of actions) {
        expect(action.kind === 'open' || action.kind === 'review').toBe(true);
        expect(action.url.startsWith('/')).toBe(true);
        expect(Object.keys(action).sort()).toEqual(['kind', 'label', 'url']);
      }
    }
  });
});

describe('lowerConfidence', () => {
  it('downgrades high confidence when a citation was invented', () => {
    const validation = {
      citations: validateCitations(
        { answer: 'x', citations: [{ type: 'audit', id: records[0].id }] },
        'x',
        records
      ).citations,
      dropped: ['audit:invented'],
      unknownInline: 0,
    };

    expect(lowerConfidence('high', validation, records)).toBe('medium');
  });

  it('never returns high with no citations', () => {
    expect(
      lowerConfidence('high', { citations: [], dropped: [], unknownInline: 0 }, records)
    ).toBe('low');
  });

  it('is low when no records were retrieved', () => {
    expect(
      lowerConfidence('high', { citations: [], dropped: [], unknownInline: 0 }, [])
    ).toBe('low');
  });
});

describe('extractInlineCitations', () => {
  it('finds multiple markers', () => {
    expect(extractInlineCitations('[audit:a] and [setting:x]')).toEqual([
      { type: 'audit', id: 'a' },
      { type: 'setting', id: 'x' },
    ]);
  });
});
