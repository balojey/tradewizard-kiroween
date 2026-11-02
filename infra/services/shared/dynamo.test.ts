import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({ send: sendMock })),
  QueryCommand: vi.fn((input: unknown) => ({ input })),
  GetItemCommand: vi.fn((input: unknown) => ({ input })),
  PutItemCommand: vi.fn((input: unknown) => ({ input })),
  UpdateItemCommand: vi.fn((input: unknown) => ({ input })),
  DeleteItemCommand: vi.fn((input: unknown) => ({ input })),
  BatchWriteItemCommand: vi.fn((input: unknown) => ({ input })),
}));

import { checkDedupCache } from './dynamo';

beforeEach(() => {
  process.env.DEDUP_CACHE_TABLE = 'dedup';
  sendMock.mockReset();
  sendMock.mockResolvedValue({ Items: [] });
});

describe('checkDedupCache', () => {
  it('ignores the in-flight marker and returns the real result below it', async () => {
    // The marker sorts above every ISO timestamp, so it arrives first.
    sendMock.mockResolvedValue({
      Items: [
        { marketId: { S: '0xmarket' }, executedAt: { S: 'IN_FLIGHT' }, ttl: { N: '9999999999' } },
        {
          marketId: { S: '0xmarket' },
          executedAt: { S: '2026-11-02T19:00:00.000Z' },
          resultId: { S: 'result-1' },
          ttl: { N: '9999999999' },
        },
      ],
    });

    const cached = await checkDedupCache('0xmarket', 60 * 60 * 1000);

    expect(cached?.resultId).toBe('result-1');
  });

  it('returns null when only the marker is present', async () => {
    sendMock.mockResolvedValue({
      Items: [{ marketId: { S: '0xmarket' }, executedAt: { S: 'IN_FLIGHT' }, ttl: { N: '1' } }],
    });

    await expect(checkDedupCache('0xmarket', 1000)).resolves.toBeNull();
  });

  it('returns null when nothing matches', async () => {
    await expect(checkDedupCache('0xmarket', 1000)).resolves.toBeNull();
  });
});
