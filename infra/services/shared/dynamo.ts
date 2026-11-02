/**
 * Shared DynamoDB client and helpers for dedup cache, connections, and rate limiting.
 */

import {
  BatchWriteItemCommand,
  DynamoDBClient,
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoClient = new DynamoDBClient({});

const DEDUP_TABLE = process.env.DEDUP_CACHE_TABLE || '';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || '';
const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE || '';

// ─── Dedup Cache ────────────────────────────────────────────────────────────────

export interface CachedResult {
  marketId: string;
  executedAt: string;
  resultId: string;
  resultPayloadS3Key: string;
  consensusProbability: number;
  recommendation: string;
  ttl: number;
}

/**
 * Check if a recent analysis result exists for a market within the freshness window.
 */
export async function checkDedupCache(
  marketId: string,
  freshnessWindowMs: number
): Promise<CachedResult | null> {
  const cutoff = new Date(Date.now() - freshnessWindowMs).toISOString();
  const now = Math.floor(Date.now() / 1000);

  const response = await dynamoClient.send(
    new QueryCommand({
      TableName: DEDUP_TABLE,
      // `executedAt > :cutoff` is the only legal condition on the sort key
      // (DynamoDB allows one per key). The in-flight marker lives in this table
      // as `executedAt = 'IN_FLIGHT'`, and 'I' sorts after every ISO timestamp,
      // so it comes back first — it is dropped below rather than in the query.
      KeyConditionExpression: 'marketId = :mid AND executedAt > :cutoff',
      FilterExpression: '#ttl > :now',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: marshall({
        ':mid': marketId,
        ':cutoff': cutoff,
        ':now': now,
      }),
      ScanIndexForward: false, // Most recent first
      // A couple of rows, not one: the marker can occupy the first slot.
      Limit: 5,
    })
  );

  const items = (response.Items ?? []).filter((item) => item.executedAt?.S !== 'IN_FLIGHT');
  if (items.length === 0) return null;

  return unmarshall(items[0]) as CachedResult;
}

/**
 * Store an analysis result in the dedup cache with TTL.
 */
export async function putDedupCache(result: CachedResult): Promise<void> {
  await dynamoClient.send(
    new PutItemCommand({
      TableName: DEDUP_TABLE,
      Item: marshall(result),
    })
  );
}

// ─── In-Flight Tracking ─────────────────────────────────────────────────────────

/**
 * Check if an analysis is currently in-flight for a market.
 * Uses a special "in-flight" entry in the dedup cache.
 */
export async function checkInFlight(marketId: string): Promise<string | null> {
  const response = await dynamoClient.send(
    new GetItemCommand({
      TableName: DEDUP_TABLE,
      Key: marshall({ marketId, executedAt: 'IN_FLIGHT' }),
    })
  );

  if (!response.Item) return null;
  const item = unmarshall(response.Item);

  // Check if TTL hasn't expired (in-flight timeout: 5 minutes)
  if (item.ttl && item.ttl < Math.floor(Date.now() / 1000)) return null;

  return item.requestId as string;
}

/**
 * Mark a market analysis as in-flight.
 */
export async function markInFlight(marketId: string, requestId: string): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 300; // 5 minute timeout
  await dynamoClient.send(
    new PutItemCommand({
      TableName: DEDUP_TABLE,
      Item: marshall({
        marketId,
        executedAt: 'IN_FLIGHT',
        requestId,
        ttl,
      }),
    })
  );
}

/**
 * Clear the in-flight marker for a market.
 */
export async function clearInFlight(marketId: string): Promise<void> {
  await dynamoClient.send(
    new DeleteItemCommand({
      TableName: DEDUP_TABLE,
      Key: marshall({ marketId, executedAt: 'IN_FLIGHT' }),
    })
  );
}

/**
 * Increment an arbitrary counter with a short TTL.
 *
 * Used by the admin API for per-minute limits, where the 35-day TTL of
 * `incrementRateLimit` would keep useless rows around.
 */
export async function incrementCounter(
  partitionKey: string,
  sortKey: string,
  ttlSeconds: number
): Promise<number> {
  const response = await dynamoClient.send(
    new UpdateItemCommand({
      TableName: RATE_LIMIT_TABLE,
      Key: marshall({ pk: partitionKey, sk: sortKey }),
      UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :one, #ttl = :ttl',
      ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
      ExpressionAttributeValues: marshall({
        ':zero': 0,
        ':one': 1,
        ':ttl': Math.floor(Date.now() / 1000) + ttlSeconds,
      }),
      ReturnValues: 'UPDATED_NEW',
    })
  );

  const count = response.Attributes?.count;
  return count ? Number(unmarshall({ count }).count) : 1;
}

// ─── Rate Limiting ──────────────────────────────────────────────────────────────

/**
 * Increment a rate limit counter. Returns the new count.
 */
export async function incrementRateLimit(
  userId: string,
  window: string // e.g. "2026-05-14T12:00" (per-minute) or "2026-05" (per-month)
): Promise<number> {
  const response = await dynamoClient.send(
    new UpdateItemCommand({
      TableName: RATE_LIMIT_TABLE,
      Key: marshall({ pk: `user#${userId}`, sk: window }),
      UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :one, #ttl = :ttl',
      ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
      ExpressionAttributeValues: marshall({
        ':zero': 0,
        ':one': 1,
        ':ttl': Math.floor(Date.now() / 1000) + 86400 * 35, // 35 days TTL
      }),
      ReturnValues: 'UPDATED_NEW',
    })
  );

  const count = response.Attributes?.count;
  return count ? Number(unmarshall({ count }).count) : 1;
}

// ─── WebSocket Connections ──────────────────────────────────────────────────────

/**
 * Store a WebSocket connection.
 */
export async function storeConnection(
  connectionId: string,
  userId: string
): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 86400; // 24h TTL
  await dynamoClient.send(
    new PutItemCommand({
      TableName: CONNECTIONS_TABLE,
      Item: marshall({ connectionId, userId, ttl, connectedAt: new Date().toISOString() }),
    })
  );
}

/**
 * Get all connections for a user (for targeted delivery).
 */
export async function getConnectionsByUser(userId: string): Promise<string[]> {
  const response = await dynamoClient.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: marshall({ ':uid': userId }),
    })
  );

  if (!response.Items) return [];
  return response.Items.map((item) => (unmarshall(item) as Record<string, string>).connectionId);
}

/**
 * Delete every cached result for a market so the next request re-runs it.
 *
 * The in-flight marker is deliberately preserved: removing it would let two
 * executions run concurrently, which is exactly what the marker prevents.
 *
 * Returns the number of cached entries removed.
 */
export async function deleteDedupCache(marketId: string): Promise<number> {
  const response = await dynamoClient.send(
    new QueryCommand({
      TableName: DEDUP_TABLE,
      KeyConditionExpression: 'marketId = :mid',
      ExpressionAttributeValues: marshall({ ':mid': marketId }),
      ProjectionExpression: 'marketId, executedAt',
    })
  );

  // DynamoDB forbids filtering on key attributes, so the in-flight marker is
  // excluded here rather than in the filter expression.
  const items = (response.Items ?? []).filter(
    (item) => item.executedAt?.S !== 'IN_FLIGHT'
  );
  if (items.length === 0) return 0;

  // BatchWriteItem caps at 25 requests per call.
  for (let index = 0; index < items.length; index += 25) {
    const chunk = items.slice(index, index + 25);

    await dynamoClient.send(
      new BatchWriteItemCommand({
        RequestItems: {
          [DEDUP_TABLE]: chunk.map((item) => ({
            DeleteRequest: { Key: { marketId: item.marketId, executedAt: item.executedAt } },
          })),
        },
      })
    );
  }

  return items.length;
}
