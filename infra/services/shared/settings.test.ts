import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, connectMock, endMock, clientCtor } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  connectMock: vi.fn(),
  endMock: vi.fn(),
  clientCtor: vi.fn(),
}));

vi.mock('pg', () => ({
  Client: clientCtor,
}));

vi.mock('./db', () => ({
  getConnectionString: vi.fn(async () => 'postgres://test'),
}));

import { getSetting, listSettings, resetSettingsCacheForTests, SETTINGS, setSetting } from './settings';

beforeEach(() => {
  // Rebuild the fake client every test: `restoreAllMocks()` would strip the
  // constructor implementation and every call would silently fall back to the
  // default value, making failure tests pass for the wrong reason.
  queryMock.mockReset();
  connectMock.mockReset().mockResolvedValue(undefined);
  endMock.mockReset().mockResolvedValue(undefined);
  clientCtor.mockReset().mockImplementation(() => ({
    connect: connectMock,
    query: queryMock,
    end: endMock,
  }));
  resetSettingsCacheForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getSetting', () => {
  it('returns the declared default when no row exists', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await expect(getSetting('analysis_paused')).resolves.toBe(false);
  });

  it('reads a stored value and caches it for the next call', async () => {
    queryMock.mockResolvedValue({ rows: [{ value: true }] });

    await expect(getSetting('analysis_paused')).resolves.toBe(true);
    await expect(getSetting('analysis_paused')).resolves.toBe(true);

    // One query for two reads: the second came from the cache.
    expect(queryMock).toHaveBeenCalledTimes(2); // SET statement_timeout + SELECT
  });

  it('falls back to the default when the database fails', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection refused'));

    // A settings read must never break the product path.
    await expect(getSetting('analysis_paused')).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it('rejects an unknown key', async () => {
    await expect(getSetting('not_a_setting')).rejects.toThrow(/Unknown setting/);
  });
});

describe('listSettings', () => {
  it('merges stored values over defaults', async () => {
    queryMock.mockResolvedValue({
      rows: [{ key: 'analysis_paused', value: true, updatedBy: 'ops@example.com', updatedAt: '2026-11-02T00:00:00.000Z' }],
    });

    const rows = await listSettings();
    const paused = rows.find((row) => row.key === 'analysis_paused');

    expect(paused).toMatchObject({ value: true, updatedBy: 'ops@example.com' });
  });
});

describe('setSetting', () => {
  it('upserts the row and refreshes the local cache', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const client = { query: queryMock } as unknown as Parameters<typeof setSetting>[0];

    await setSetting(client, 'analysis_paused', true, 'ops@example.com');

    const upsert = queryMock.mock.calls.find((call) => String(call[0]).includes('INSERT INTO system_settings'));
    expect(upsert).toBeDefined();
    expect(upsert?.[1]).toEqual(['analysis_paused', 'true', SETTINGS.analysis_paused.description, 'ops@example.com']);
  });
});
