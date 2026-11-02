/**
 * Presigned S3 URLs for analysis payloads.
 *
 * The browser fetches the payload directly from S3 (architecture doc D6): the
 * payloads are large, and proxying them through Lambda would waste invocation
 * time and memory for no benefit.
 *
 * Constraints:
 * - 60 second TTL
 * - the URL is never logged and never stored in an audit row
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpError } from './responses';

const TTL_SECONDS = 60;
const s3Client = new S3Client({});

export async function presignPayloadUrl(key: string): Promise<string> {
  const bucket = process.env.ANALYSIS_BUCKET;
  if (!bucket) {
    throw new HttpError(500, 'INTERNAL', 'ANALYSIS_BUCKET is not configured');
  }

  return getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: TTL_SECONDS }
  );
}

export const PAYLOAD_URL_TTL_SECONDS = TTL_SECONDS;
