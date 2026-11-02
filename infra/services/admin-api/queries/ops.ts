/**
 * Operational health for the portal.
 *
 * Three sources, all read-only:
 * - SQS queue attributes (depth, in-flight, oldest message age)
 * - CloudWatch metrics (Lambda invocations/errors/duration/throttles, alarm
 *   state, approximate DynamoDB item counts)
 * - The database itself (size and connection count)
 *
 * Deliberately not included: a live WebSocket connection count. Connections are
 * a TTL'd DynamoDB table; counting them requires a scan of the whole table, which
 * is exactly the kind of query this portal must not issue. The CloudWatch
 * `ItemCount` metric is used instead, and labelled as approximate.
 */

import {
  SQSClient,
  GetQueueAttributesCommand,
  QueueAttributeName,
} from '@aws-sdk/client-sqs';
import {
  CloudWatchClient,
  GetMetricDataCommand,
  DescribeAlarmsCommand,
  type MetricDataQuery,
} from '@aws-sdk/client-cloudwatch';
import type { Client } from 'pg';

const sqs = new SQSClient({});
const cloudwatch = new CloudWatchClient({});

const METRIC_PERIOD_SECONDS = 3600;
const WINDOW_HOURS = 24;

export interface QueueHealth {
  visible: number;
  inFlight: number;
  delayed: number;
  oldestMessageAgeSeconds: number | null;
}

async function readQueue(url: string | undefined): Promise<QueueHealth | null> {
  if (!url) return null;

  const response = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: url,
      // Note: message age is NOT a GetQueueAttributes attribute — it is an
      // SQS CloudWatch metric, read separately below.
      AttributeNames: [
        'ApproximateNumberOfMessages',
        'ApproximateNumberOfMessagesNotVisible',
        'ApproximateNumberOfMessagesDelayed',
      ] as QueueAttributeName[],
    })
  );

  const attributes: Record<string, string | undefined> = response.Attributes ?? {};
  const num = (key: string): number => Number(attributes[key] ?? 0);

  return {
    visible: num('ApproximateNumberOfMessages'),
    inFlight: num('ApproximateNumberOfMessagesNotVisible'),
    delayed: num('ApproximateNumberOfMessagesDelayed'),
    oldestMessageAgeSeconds: null, // filled from CloudWatch
  };
}

interface LambdaHealth {
  name: string;
  invocations: number;
  errors: number;
  throttles: number;
  errorRate: number | null;
  avgDurationMs: number | null;
}

/**
 * One CloudWatch request for every function: 3 metrics × N functions + 1
 * DynamoDB metric. Batching keeps the portal from making a request per function.
 */
async function readCloudWatchMetrics(
  functionNames: string[],
  connectionsTable: string | undefined,
  queueNames: string[]
): Promise<{
  functions: LambdaHealth[];
  approxConnections: number | null;
  queueAges: Map<string, number>;
}> {
  if (functionNames.length === 0 && queueNames.length === 0) {
    return { functions: [], approxConnections: null, queueAges: new Map() };
  }

  const queries: MetricDataQuery[] = [];

  functionNames.forEach((name, index) => {
    queries.push(
      metricQuery(`inv${index}`, 'AWS/Lambda', 'Invocations', 'Sum', [{ Name: 'FunctionName', Value: name }]),
      metricQuery(`err${index}`, 'AWS/Lambda', 'Errors', 'Sum', [{ Name: 'FunctionName', Value: name }]),
      metricQuery(`dur${index}`, 'AWS/Lambda', 'Duration', 'Average', [{ Name: 'FunctionName', Value: name }]),
      metricQuery(`thr${index}`, 'AWS/Lambda', 'Throttles', 'Sum', [{ Name: 'FunctionName', Value: name }])
    );
  });

  queueNames.forEach((name, index) => {
    queries.push({
      Id: `age${index}`,
      Label: `Oldest message age (${name})`,
      MetricStat: {
        Metric: {
          Namespace: 'AWS/SQS',
          MetricName: 'ApproximateAgeOfOldestMessage',
          Dimensions: [{ Name: 'QueueName', Value: name }],
        },
        Period: 300,
        Stat: 'Maximum',
      },
      ReturnData: true,
    });
  });

  if (connectionsTable) {
    queries.push({
      Id: 'wsitems',
      Label: 'WebSocket connections (approx)',
      MetricStat: {
        Metric: {
          Namespace: 'AWS/DynamoDB',
          MetricName: 'ItemCount',
          Dimensions: [{ Name: 'TableName', Value: connectionsTable }],
        },
        Period: 21600,
        Stat: 'Maximum',
      },
      ReturnData: true,
    });
  }

  const response = await cloudwatch.send(
    new GetMetricDataCommand({
      StartTime: new Date(Date.now() - WINDOW_HOURS * 3_600_000),
      EndTime: new Date(),
      MetricDataQueries: queries,
      ScanBy: 'TimestampDescending',
    })
  );

  const totals = new Map<string, number>();
  for (const result of response.MetricDataResults ?? []) {
    const values: number[] = result.Values ?? [];
    // Sum metrics: add all points. Average metrics: use the mean of the points.
    const id = result.Id ?? '';
    // Points arrive newest-first. Averages use the mean of the window; ages are
    // a "right now" gauge, so take the most recent point. Sums add the window.
    const isAverage = id.startsWith('dur') || id === 'wsitems';
    const isGauge = id.startsWith('age');

    totals.set(
      id,
      values.length === 0
        ? 0
        : isGauge
          ? values[0]
          : isAverage
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : values.reduce((sum, value) => sum + value, 0)
    );
  }

  const functions = functionNames.map((name, index) => {
    const invocations = totals.get(`inv${index}`) ?? 0;
    const errors = totals.get(`err${index}`) ?? 0;

    return {
      name,
      invocations,
      errors,
      throttles: totals.get(`thr${index}`) ?? 0,
      errorRate: invocations > 0 ? errors / invocations : null,
      avgDurationMs: totals.get(`dur${index}`) ?? null,
    };
  });

  const ws = totals.get('wsitems');

  const queueAges = new Map<string, number>();
  queueNames.forEach((name, index) => {
    const value = totals.get(`age${index}`);
    if (value !== undefined && value > 0) queueAges.set(name, Math.round(value));
  });

  return {
    functions,
    approxConnections: ws === undefined || ws === 0 ? null : Math.round(ws),
    queueAges,
  };
}

function metricQuery(
  id: string,
  namespace: string,
  metricName: string,
  stat: string,
  dimensions: Array<{ Name: string; Value: string }>
): MetricDataQuery {
  return {
    Id: id,
    ReturnData: true,
    MetricStat: {
      Metric: { Namespace: namespace, MetricName: metricName, Dimensions: dimensions },
      Period: METRIC_PERIOD_SECONDS,
      Stat: stat,
    },
  };
}

interface AlarmState {
  name: string;
  state: string;
  updatedAt: string | null;
  reason: string | null;
}

async function readAlarms(): Promise<AlarmState[]> {
  const response = await cloudwatch.send(
    new DescribeAlarmsCommand({ MaxRecords: 50, StateValue: 'ALARM' })
  );

  const alarms = (response.MetricAlarms ?? []).map((alarm) => ({
    name: alarm.AlarmName ?? '(unnamed)',
    state: alarm.StateValue ?? 'UNKNOWN',
    updatedAt: alarm.StateUpdatedTimestamp?.toISOString() ?? null,
    reason: alarm.StateReason ?? null,
  }));

  // Also report non-OK states that are not ALARM (e.g. INSUFFICIENT_DATA).
  const all = await cloudwatch.send(new DescribeAlarmsCommand({ MaxRecords: 100 }));
  const others = (all.MetricAlarms ?? [])
    .filter((alarm) => (alarm.StateValue ?? 'OK') !== 'OK')
    .filter((alarm) => !alarms.some((known) => known.name === alarm.AlarmName))
    .map((alarm) => ({
      name: alarm.AlarmName ?? '(unnamed)',
      state: alarm.StateValue ?? 'UNKNOWN',
      updatedAt: alarm.StateUpdatedTimestamp?.toISOString() ?? null,
      reason: alarm.StateReason ?? null,
    }));

  return [...alarms, ...others];
}

interface DatabaseHealth {
  reachable: boolean;
  sizeBytes: number | null;
  connections: number | null;
}

async function readDatabase(client: Client): Promise<DatabaseHealth> {
  try {
    const result = await client.query(`
      SELECT
        pg_database_size(current_database())::bigint AS size,
        (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS connections
    `);

    const row = result.rows[0] ?? {};
    return {
      reachable: true,
      sizeBytes: row.size === null || row.size === undefined ? null : Number(row.size),
      connections: row.connections ?? null,
    };
  } catch (error) {
    console.error('Ops health: database probe failed', error);
    return { reachable: false, sizeBytes: null, connections: null };
  }
}

export interface OpsHealth {
  generatedAt: string;
  windowHours: number;
  queues: { analysis: QueueHealth | null; deadLetter: QueueHealth | null };
  functions: LambdaHealth[];
  alarms: AlarmState[];
  websocket: { approxConnections: number | null; note: string };
  database: DatabaseHealth;
}

export async function getOpsHealth(client: Client): Promise<OpsHealth> {
  const functionNames = (process.env.OPS_LAMBDA_NAMES ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  const analysisQueueUrl = process.env.ANALYSIS_QUEUE_URL;
  const deadLetterQueueUrl = process.env.DLQ_URL;

  const queueName = (url: string | undefined): string[] => {
    if (!url) return [];
    const name = new URL(url).pathname.split('/').filter(Boolean).pop();
    return name ? [name] : [];
  };
  const queueNames = [...queueName(analysisQueueUrl), ...queueName(deadLetterQueueUrl)];

  const [analysisQueue, deadLetterQueue, metrics, alarms, database] = await Promise.all([
    readQueue(analysisQueueUrl),
    readQueue(deadLetterQueueUrl),
    readCloudWatchMetrics(functionNames, process.env.CONNECTIONS_TABLE, queueNames),
    readAlarms(),
    readDatabase(client),
  ]);

  // Attach the CloudWatch-derived age to each queue.
  const withAge = (queue: QueueHealth | null, url: string | undefined): QueueHealth | null => {
    if (!queue) return null;
    const name = queueName(url)[0];
    return {
      ...queue,
      oldestMessageAgeSeconds: name ? metrics.queueAges.get(name) ?? null : null,
    };
  };

  return {
    generatedAt: new Date().toISOString(),
    windowHours: WINDOW_HOURS,
    queues: {
      analysis: withAge(analysisQueue, analysisQueueUrl),
      deadLetter: withAge(deadLetterQueue, deadLetterQueueUrl),
    },
    functions: metrics.functions,
    alarms,
    websocket: {
      approxConnections: metrics.approxConnections,
      note: 'DynamoDB ItemCount, refreshed roughly every 6 hours',
    },
    database,
  };
}
