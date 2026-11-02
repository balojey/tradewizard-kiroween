import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dynamoSendMock, eventSendMock } = vi.hoisted(() => ({
  dynamoSendMock: vi.fn(),
  eventSendMock: vi.fn(),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({ send: dynamoSendMock })),
  GetItemCommand: vi.fn((input: unknown) => ({ kind: 'get', input })),
  PutItemCommand: vi.fn((input: unknown) => ({ kind: 'put', input })),
  DeleteItemCommand: vi.fn((input: unknown) => ({ kind: 'delete', input })),
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn(() => ({ send: eventSendMock })),
  PutEventsCommand: vi.fn((input: unknown) => ({ kind: 'put-events', input })),
}));

import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import {
  activateGlobal,
  activateUser,
  isGlobalActive,
  isHalted,
  isUserActive,
  publishTriggered,
  resetGlobal,
  resetUser,
} from './kill-switch';

const ORIGINAL_ENV = { ...process.env };
const TABLE = 'tw-test-rate-limits';

interface CommandCall {
  kind: string;
  input: {
    TableName?: string;
    Key?: Record<string, unknown>;
    Item?: Record<string, unknown>;
    ConsistentRead?: boolean;
    Entries?: Array<Record<string, unknown>>;
  };
}

function lastCommand(): CommandCall {
  const calls = dynamoSendMock.mock.calls;
  return calls[calls.length - 1][0] as CommandCall;
}

function allCommands(): CommandCall[] {
  return dynamoSendMock.mock.calls.map((call) => call[0] as CommandCall);
}

/** Item payload as unmarshall will see it (S/N/BOOL typed). */
function storedItem(values: Record<string, unknown>): Record<string, unknown> {
  return marshall(values);
}

/** Decode a written item so assertions can use plain values. */
function readItem(item?: Record<string, unknown>): Record<string, unknown> {
  return unmarshall(item as Record<string, AttributeValue>);
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.RATE_LIMIT_TABLE = TABLE;
  dynamoSendMock.mockReset();
  eventSendMock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('isUserActive', () => {
  it('returns false when no state item exists', async () => {
    dynamoSendMock.mockResolvedValue({});

    await expect(isUserActive('user-1')).resolves.toBe(false);

    const command = lastCommand();
    expect(command.kind).toBe('get');
    expect(command.input.TableName).toBe(TABLE);
    expect(command.input.Key).toEqual(marshall({ pk: 'kill_switch#user-1', sk: 'state' }));
    expect(command.input.ConsistentRead).toBe(true);
  });

  it('returns true when the stored state is active', async () => {
    dynamoSendMock.mockResolvedValue({
      Item: storedItem({ pk: 'kill_switch#user-1', sk: 'state', active: true, ttl: 1 }),
    });

    await expect(isUserActive('user-1')).resolves.toBe(true);
  });

  it('returns false when the stored state is inactive', async () => {
    dynamoSendMock.mockResolvedValue({
      Item: storedItem({ pk: 'kill_switch#user-1', sk: 'state', active: false, ttl: 1 }),
    });

    await expect(isUserActive('user-1')).resolves.toBe(false);
  });

  it('fails closed when DynamoDB cannot be read', async () => {
    dynamoSendMock.mockRejectedValue(new Error('throttled'));

    await expect(isUserActive('user-1')).resolves.toBe(true);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('isGlobalActive', () => {
  it('reads the global partition key, not a user key', async () => {
    dynamoSendMock.mockResolvedValue({});

    await isGlobalActive();

    expect(lastCommand().input.Key).toEqual(
      marshall({ pk: 'kill_switch#global', sk: 'state' })
    );
  });

  it('fails closed when DynamoDB cannot be read', async () => {
    dynamoSendMock.mockRejectedValue(new Error('timeout'));

    await expect(isGlobalActive()).resolves.toBe(true);
  });
});

describe('isHalted', () => {
  it('checks both the global and the user switch', async () => {
    dynamoSendMock.mockResolvedValue({});

    await expect(isHalted('user-1')).resolves.toBe(false);

    expect(allCommands()).toHaveLength(2);
    const keys = allCommands().map((command) => command.input.Key);
    expect(keys).toEqual(
      expect.arrayContaining([
        marshall({ pk: 'kill_switch#global', sk: 'state' }),
        marshall({ pk: 'kill_switch#user-1', sk: 'state' }),
      ])
    );
  });

  it('halts when only the global switch is active', async () => {
    dynamoSendMock.mockImplementation(async (command: CommandCall) => {
      const key = command.input.Key as Record<string, { S?: string }>;
      const isGlobalKey = key.pk.S === 'kill_switch#global';
      return isGlobalKey
        ? { Item: storedItem({ active: true, ttl: 1 }) }
        : {};
    });

    await expect(isHalted('user-1')).resolves.toBe(true);
  });

  it('halts when only the user switch is active', async () => {
    dynamoSendMock.mockImplementation(async (command: CommandCall) => {
      const key = command.input.Key as Record<string, { S?: string }>;
      const isUserKey = key.pk.S === 'kill_switch#user-1';
      return isUserKey ? { Item: storedItem({ active: true, ttl: 1 }) } : {};
    });

    await expect(isHalted('user-1')).resolves.toBe(true);
  });

  it('fails closed when either read fails', async () => {
    dynamoSendMock.mockImplementation(async (command: CommandCall) => {
      const key = command.input.Key as Record<string, { S?: string }>;
      if (key.pk.S === 'kill_switch#global') throw new Error('throttled');
      return {};
    });

    await expect(isHalted('user-1')).resolves.toBe(true);
  });
});

describe('activateUser', () => {
  it('persists an active state with the user key and a one-year TTL', async () => {
    dynamoSendMock.mockResolvedValue({});
    const before = Math.floor(Date.now() / 1000);

    const state = await activateUser('user-1', { reason: 'manual' });

    const command = lastCommand();
    expect(command.kind).toBe('put');
    expect(command.input.TableName).toBe(TABLE);
    expect(readItem(command.input.Item)).toMatchObject({
      pk: 'kill_switch#user-1',
      sk: 'state',
      active: true,
      reason: 'manual',
    });
    expect(state.active).toBe(true);
    expect(state.reason).toBe('manual');
    expect(state.ttl).toBeGreaterThanOrEqual(before + 364 * 24 * 60 * 60);
    expect(state.ttl).toBeLessThanOrEqual(before + 366 * 24 * 60 * 60);
  });

  it('records the actor when provided and omits it otherwise', async () => {
    dynamoSendMock.mockResolvedValue({});

    const withActor = await activateUser('user-1', { reason: 'r', actor: 'admin:abc' });
    expect(withActor.actor).toBe('admin:abc');
    expect(readItem(lastCommand().input.Item).actor).toBe('admin:abc');

    const withoutActor = await activateUser('user-1', { reason: 'r' });
    expect(withoutActor.actor).toBeUndefined();
    expect(readItem(lastCommand().input.Item).actor).toBeUndefined();
  });

  it('throws when the state cannot be persisted', async () => {
    dynamoSendMock.mockRejectedValue(new Error('write failed'));

    await expect(activateUser('user-1', { reason: 'r' })).rejects.toThrow('write failed');
  });

  it('throws when the table name is not configured', async () => {
    delete process.env.RATE_LIMIT_TABLE;

    await expect(activateUser('user-1', { reason: 'r' })).rejects.toThrow(
      /RATE_LIMIT_TABLE/
    );
  });
});

describe('activateGlobal', () => {
  it('writes the global partition key', async () => {
    dynamoSendMock.mockResolvedValue({});
    process.env.EVENT_BUS_NAME = 'bus';

    await activateGlobal({ reason: 'platform maintenance', actor: 'admin:ops' });

    expect(readItem(lastCommand().input.Item)).toMatchObject({
      pk: 'kill_switch#global',
      sk: 'state',
      active: true,
      reason: 'platform maintenance',
      actor: 'admin:ops',
    });
  });
});

describe('reset', () => {
  it('deletes the user state key', async () => {
    dynamoSendMock.mockResolvedValue({});

    await resetUser('user-1');

    expect(lastCommand().kind).toBe('delete');
    expect(lastCommand().input.Key).toEqual(
      marshall({ pk: 'kill_switch#user-1', sk: 'state' })
    );
  });

  it('deletes the global state key', async () => {
    dynamoSendMock.mockResolvedValue({});

    await resetGlobal();

    expect(lastCommand().input.Key).toEqual(
      marshall({ pk: 'kill_switch#global', sk: 'state' })
    );
  });

  it('throws when the delete fails', async () => {
    dynamoSendMock.mockRejectedValue(new Error('nope'));

    await expect(resetUser('user-1')).rejects.toThrow('nope');
  });
});

describe('publishTriggered', () => {
  it('emits the payload the notification lambdas consume', async () => {
    eventSendMock.mockResolvedValue({});
    process.env.EVENT_BUS_NAME = 'tw-test-bus';

    await publishTriggered({
      userId: 'user-1',
      reason: 'manual',
      sessionsAffected: ['s1', 's2'],
      triggeredAt: '2026-11-02T00:00:00.000Z',
      scope: 'user',
    });

    const command = eventSendMock.mock.calls[0][0] as CommandCall;
    const entry = command.input.Entries?.[0] as Record<string, string>;
    const detail = JSON.parse(entry.Detail);

    expect(entry.Source).toBe('tradewizard.portfolio.risk-engine');
    expect(entry.DetailType).toBe('portfolio.kill_switch.triggered');
    expect(entry.EventBusName).toBe('tw-test-bus');
    expect(detail).toMatchObject({
      userId: 'user-1',
      reason: 'manual',
      sessionsAffected: ['s1', 's2'],
      triggeredAt: '2026-11-02T00:00:00.000Z',
      scope: 'user',
    });
  });

  it('never throws when publication fails', async () => {
    eventSendMock.mockRejectedValue(new Error('bus down'));

    await expect(
      publishTriggered({ userId: 'u', reason: 'r', sessionsAffected: [] })
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
