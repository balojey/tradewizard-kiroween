/**
 * Pending-order cancellation, shared by the product and admin paths.
 *
 * Small on purpose: cancelling an order is one CLOB DELETE plus a ledger
 * update. It has none of the escalation logic that keeps the position-exit code
 * inside the risk engine (see §14.4, slice 1b).
 */

import type { Client } from 'pg';
import {
  buildClobHeaders,
  clobCredentialsConfigured,
  getClobCredentials,
} from './clob-credentials';

export async function cancelClobOrder(orderId: string): Promise<boolean> {
  try {
    const creds = await getClobCredentials();
    if (!clobCredentialsConfigured(creds)) {
      console.error(`CLOB credentials not configured; cannot cancel orderId=${orderId}.`);
      return false;
    }

    const response = await fetch(`${creds.apiUrl}/order/${orderId}`, {
      method: 'DELETE',
      headers: buildClobHeaders(creds),
      signal: AbortSignal.timeout(10_000),
    });

    return response.ok;
  } catch (error) {
    console.error(`Cancel order ${orderId} failed:`, error);
    return false;
  }
}

export interface CancelledOrders {
  cancelled: number;
  releasedUsdc: number;
}

/**
 * Cancel a session's pending orders and release their capital back to available.
 *
 * The trade rows are marked cancelled even when the exchange call fails: leaving
 * them `pending` would make the session believe it still has working orders that
 * it cannot see.
 */
export async function cancelPendingOrders(
  client: Client,
  sessionId: string
): Promise<CancelledOrders> {
  const pending = await client.query(
    `
    SELECT id, clob_order_id, size_usdc
    FROM portfolio_manager_trades
    WHERE session_id = $1 AND status = 'pending'
    `,
    [sessionId]
  );

  if (pending.rows.length === 0) {
    return { cancelled: 0, releasedUsdc: 0 };
  }

  const now = new Date().toISOString();
  let releasedUsdc = 0;

  for (const trade of pending.rows) {
    if (trade.clob_order_id) {
      await cancelClobOrder(trade.clob_order_id);
    }

    await client.query(
      `UPDATE portfolio_manager_trades SET status = 'cancelled', cancelled_at = $1 WHERE id = $2`,
      [now, trade.id]
    );

    releasedUsdc += Number(trade.size_usdc ?? 0);
  }

  if (releasedUsdc > 0) {
    await client.query(
      `
      UPDATE portfolio_manager_sessions
      SET amount_in_pending_orders = amount_in_pending_orders - $1,
          amount_available = amount_available + $1,
          updated_at = now()
      WHERE id = $2
      `,
      [releasedUsdc, sessionId]
    );
  }

  return { cancelled: pending.rows.length, releasedUsdc };
}
