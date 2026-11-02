/**
 * Kill switch state — single source of truth.
 *
 * State lives in the rate-limit DynamoDB table (no extra table, no extra IAM):
 *   per-user : pk = `kill_switch#{userId}`, sk = 'state'
 *   global   : pk = `kill_switch#global`,   sk = 'state'
 *
 * A global switch halts every user; a user switch halts one user. Both are
 * checked by `isHalted()`, which is what trading paths must call.
 *
 * Failure semantics (deliberate):
 * - READERS FAIL CLOSED. If DynamoDB cannot be read, the switch is treated as
 *   active. Refusing to trade during an infrastructure fault is the safe
 *   outcome; the alternative is trading while blind.
 * - WRITERS THROW. Activation and reset surface errors to the caller so the
 *   API returns a failure instead of silently pretending to have halted.
 * - EVENT PUBLICATION IS BEST EFFORT. A notification failure must not undo a
 *   successful halt, so it is logged and swallowed.
 *
 * Naming convention used across the portal docs:
 * - `kill_switch#{userId}` / `kill_switch#global` -> `state`
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoClient = new DynamoDBClient({});
const eventBridgeClient = new EventBridgeClient({});

/** Kept at one year so a forgotten switch does not silently expire mid-position. */
const TTL_SECONDS = 365 * 24 * 60 * 60;

const GLOBAL_PARTITION_KEY = 'kill_switch#global';
const STATE_SORT_KEY = 'state';

export type KillSwitchScope = 'user' | 'global';

export interface KillSwitchActivationOptions {
  reason: string;
  /** Who triggered it (`admin:{sub}` or a user id). Optional and additive. */
  actor?: string;
}

export interface KillSwitchState {
  active: boolean;
  triggeredAt: string;
  reason: string;
  actor?: string;
  ttl: number;
}

export interface KillSwitchTriggeredPayload {
  userId: string;
  reason: string;
  sessionsAffected: string[];
  triggeredAt?: string;
  scope?: KillSwitchScope;
}

// ─── Internals ───────────────────────────────────────────────────────────────

function resolveTableName(): string {
  const table = process.env.RATE_LIMIT_TABLE;
  if (!table) {
    throw new Error('RATE_LIMIT_TABLE environment variable is not set');
  }
  return table;
}

function userPartitionKey(userId: string): string {
  return `kill_switch#${userId}`;
}

async function readState(partitionKey: string): Promise<boolean> {
  const response = await dynamoClient.send(
    new GetItemCommand({
      TableName: resolveTableName(),
      Key: marshall({ pk: partitionKey, sk: STATE_SORT_KEY }),
      ConsistentRead: true,
    })
  );

  if (!response.Item) return false;

  const item = unmarshall(response.Item) as Record<string, unknown>;
  return item.active === true;
}

async function writeState(
  partitionKey: string,
  options: KillSwitchActivationOptions
): Promise<KillSwitchState> {
  const state: KillSwitchState = {
    active: true,
    triggeredAt: new Date().toISOString(),
    reason: options.reason,
    ...(options.actor ? { actor: options.actor } : {}),
    ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };

  await dynamoClient.send(
    new PutItemCommand({
      TableName: resolveTableName(),
      Item: marshall({ pk: partitionKey, sk: STATE_SORT_KEY, ...state }),
    })
  );

  return state;
}

async function clearState(partitionKey: string): Promise<void> {
  await dynamoClient.send(
    new DeleteItemCommand({
      TableName: resolveTableName(),
      Key: marshall({ pk: partitionKey, sk: STATE_SORT_KEY }),
    })
  );
}

// ─── Readers (fail closed) ───────────────────────────────────────────────────

/** True when this user's kill switch is active. Fails closed. */
export async function isUserActive(userId: string): Promise<boolean> {
  try {
    return await readState(userPartitionKey(userId));
  } catch (error) {
    console.error(
      'Kill switch: failed to read user state; treating trading as halted.',
      error
    );
    return true;
  }
}

/** True when the global kill switch is active. Fails closed. */
export async function isGlobalActive(): Promise<boolean> {
  try {
    return await readState(GLOBAL_PARTITION_KEY);
  } catch (error) {
    console.error(
      'Kill switch: failed to read global state; treating trading as halted.',
      error
    );
    return true;
  }
}

/**
 * True when trading must be halted for this user — either their own switch or
 * the global one. This is the only function trading paths should call.
 */
export async function isHalted(userId: string): Promise<boolean> {
  const [globalActive, userActive] = await Promise.all([
    isGlobalActive(),
    isUserActive(userId),
  ]);

  return globalActive || userActive;
}

// ─── Writers (throw on failure) ──────────────────────────────────────────────

/** Halt trading for one user. Throws if the state cannot be persisted. */
export async function activateUser(
  userId: string,
  options: KillSwitchActivationOptions
): Promise<KillSwitchState> {
  return writeState(userPartitionKey(userId), options);
}

/** Halt trading for every user. Throws if the state cannot be persisted. */
export async function activateGlobal(
  options: KillSwitchActivationOptions
): Promise<KillSwitchState> {
  return writeState(GLOBAL_PARTITION_KEY, options);
}

/** Resume trading for one user. Throws if the state cannot be cleared. */
export async function resetUser(userId: string): Promise<void> {
  await clearState(userPartitionKey(userId));
}

/** Clear the global halt. Throws if the state cannot be cleared. */
export async function resetGlobal(): Promise<void> {
  await clearState(GLOBAL_PARTITION_KEY);
}

// ─── Notifications ───────────────────────────────────────────────────────────

/**
 * Publish `portfolio.kill_switch.triggered` for notification fan-out.
 *
 * Source and payload shape match what `portfolio-notification` and
 * `portfolio-ws-delivery` already consume (`sessionsAffected` is required by
 * both). Best effort: a publish failure is logged, never thrown.
 */
export async function publishTriggered(
  payload: KillSwitchTriggeredPayload
): Promise<void> {
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'tradewizard.portfolio.risk-engine',
            DetailType: 'portfolio.kill_switch.triggered',
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
            Detail: JSON.stringify({
              userId: payload.userId,
              reason: payload.reason,
              sessionsAffected: payload.sessionsAffected,
              triggeredAt: payload.triggeredAt || new Date().toISOString(),
              ...(payload.scope ? { scope: payload.scope } : {}),
            }),
          },
        ],
      })
    );
  } catch (error) {
    console.error('Failed to publish kill switch event:', error);
    // Non-fatal: the halt already succeeded.
  }
}
