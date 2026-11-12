export interface UserSummary {
  id: string;
  email: string;
  displayName: string | null;
  status: "active" | "suspended" | "banned";
  createdAt: string;
  plan: string | null;
  subscriptionStatus: string | null;
  creditsRemaining: number | null;
  creditsMonthlyLimit: number | null;
  billingCycleEnd: string | null;
}

export interface UserDetail extends UserSummary {
  cognitoSub: string;
  portfolioPersonaId: string | null;
  portfolioPersonaParams: Record<string, unknown> | null;
  hasUsedPaidPlan: boolean;
  updatedAt: string;
  billingCycleStart: string | null;
  isTrial: boolean;
  trialEnd: string | null;
  walletAddress: string | null;
  renewalPausedAt: string | null;
  overridePlan: string | null;
  overridePreviousPlan: string | null;
  overrideExpiresAt: string | null;
  analysesDelivered: number;
  sessionsTotal: number;
  paymentsTotal: number;
  lifetimeUsdc: number;
}

export interface CreditRow {
  id: string;
  amount: number;
  balanceAfter: number;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  creditSource: string | null;
  createdAt: string;
}

export interface AnalysisRow {
  deliveryId: string;
  deliveredAt: string;
  wasCached: boolean;
  channel: string;
  resultId: string;
  marketId: string;
  marketQuestion: string | null;
  recommendation: string | null;
  consensusProbability: number | null;
  confidence: number | null;
  outcomeStatus: string | null;
}

export interface SessionRow {
  id: string;
  marketId: string;
  personaId: string;
  investmentAmount: number;
  status: string;
  positionDirection: string | null;
  totalTrades: number;
  winningTrades: number;
  realizedPnl: number;
  unrealizedPnl: number;
  amountAvailable: number;
  terminationReason: string | null;
  createdAt: string;
  terminatedAt: string | null;
}

export interface PaymentRow {
  id: string;
  transactionType: string;
  amountUsdc: number;
  txHash: string;
  plan: string | null;
  creditPackId: string | null;
  creditsAdded: number | null;
  createdAt: string;
}

export interface NoteRow {
  id: string;
  authorEmail: string;
  body: string;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ExecutionRow {
  id: string;
  marketId: string;
  marketQuestion: string | null;
  executedAt: string;
  recommendation: string | null;
  consensusProbability: number | null;
  confidence: number | null;
  edge: number | null;
  outcomeStatus: string | null;
  noTradeReason: string | null;
  shadowAction: string | null;
  shadowEdge: number | null;
  totalLlmCalls: number | null;
  modelCostsUsd: number | null;
  executionDurationMs: number | null;
}

export interface AnalysisDetail extends ExecutionRow {
  payloadUrl: string | null;
  payloadUrlExpiresInSeconds: number;
  marketProbability: number | null;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLossPrice: number | null;
  outcomeHitPrice: number | null;
  outcomeResolvedAt: string | null;
  agentsScored: boolean;
  shadowProbability: number | null;
  shadowVoteScore: number | null;
  shadowCostFloor: number | null;
  shadowReason: string | null;
  horizonHours: number | null;
  horizonMove: number | null;
  livePnl: number | null;
  shadowPnl: number | null;
  pnlScoredAt: string | null;
  createdAt: string;
}

export interface QualityBucket {
  label?: string;
  reason?: string;
  bucket?: string;
  status?: string;
  count: number;
}

export interface QualityReport {
  window: { from: string; to: string };
  totals: {
    executions: number;
    markets: number;
    avgProbability: number | null;
    avgDurationMs: number | null;
    totalCostUsd: number | null;
    avgEdge: number | null;
  };
  recommendations: QualityBucket[];
  noTradeReasons: QualityBucket[];
  edgeBuckets: QualityBucket[];
  outcomes: QualityBucket[];
  shadow: {
    withShadow: number;
    agree: number;
    disagree: number;
    scored: number;
    avgLivePnl: number | null;
    avgShadowPnl: number | null;
  };
}

export interface PortfolioSessionRow {
  id: string;
  userId: string;
  userEmail: string | null;
  marketId: string;
  marketQuestion: string | null;
  personaId: string;
  status: string;
  investmentAmount: number;
  amountInPositions: number;
  amountInPendingOrders: number;
  amountAvailable: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalTrades: number;
  winningTrades: number;
  positionDirection: string | null;
  cumulativeLossPct: number;
  createdAt: string;
  updatedAt: string;
  terminatedAt: string | null;
}

export interface PortfolioSessionDetail extends PortfolioSessionRow {
  personaConfig: Record<string, unknown> | null;
  positionSize: number | null;
  positionEntryPrice: number | null;
  positionEntryAt: string | null;
  profitTargetPct: number | null;
  lastLossExitAt: string | null;
  positionSizeReductionActive: boolean;
  terminationReason: string | null;
  totalHoldDurationMinutes: number;
  tradesTotal: number;
  decisionsTotal: number;
}

export interface PortfolioTradeRow {
  id: string;
  analysisResultId: string | null;
  direction: string;
  side: string;
  orderType: string;
  sizeUsdc: number;
  price: number;
  fillPrice: number | null;
  shares: number | null;
  status: string;
  clobOrderId: string | null;
  tradePurpose: string;
  reasoning: string | null;
  convictionScore: number | null;
  createdAt: string;
  filledAt: string | null;
  cancelledAt: string | null;
  realizedPnl: number | null;
  holdDurationMinutes: number | null;
  exitReason: string | null;
}

export interface PortfolioDecisionRow {
  id: string;
  analysisResultId: string | null;
  action: string;
  edgeMet: boolean | null;
  alignmentMet: boolean | null;
  convictionScore: number | null;
  additionalCriteriaMet: boolean | null;
  hadPosition: boolean;
  positionDirection: string | null;
  positionUnrealizedPnl: number | null;
  reasoning: string;
  skipReason: string | null;
  createdAt: string;
}

export interface PortfolioExposure {
  totals: {
    openSessions: number;
    activeSessions: number;
    users: number;
    capitalAtRisk: number;
    capitalAvailable: number;
    unrealizedPnl: number;
    realizedPnl: number;
    pendingOrders: number;
    sessionsReduced: number;
    sessionsNearLossLimit: number;
  };
  byPersona: Array<{ personaId: string; sessions: number; capitalAtRisk: number }>;
}

export interface LedgerPayment {
  id: string;
  userId: string;
  userEmail: string | null;
  type: string;
  amountUsdc: number;
  txHash: string;
  plan: string | null;
  creditPackId: string | null;
  creditsAdded: number | null;
  sourceAddress: string;
  createdAt: string;
}

export interface SubscriptionRow {
  id: string;
  userId: string;
  userEmail: string | null;
  plan: string;
  status: string;
  creditsRemaining: number;
  creditsMonthlyLimit: number;
  billingCycleStart: string | null;
  billingCycleEnd: string | null;
  isTrial: boolean;
  trialEnd: string | null;
  gracePeriodEnd: string | null;
  renewalPausedAt: string | null;
  overridePlan: string | null;
  overridePreviousPlan: string | null;
  overrideExpiresAt: string | null;
  walletAddress: string | null;
  createdAt: string;
  renewalState: "ok" | "failing" | "grace" | "paused";
}

export interface BillingSummary {
  window: { from: string; to: string };
  revenue: {
    payments: number;
    totalUsdc: number;
    subscriptionUsdc: number;
    creditPackUsdc: number;
    payers: number;
  };
  byPlan: Array<{ plan: string; count: number }>;
  renewal: {
    active: number;
    trials: number;
    inGrace: number;
    pastDue: number;
    paused: number;
    cancelled: number;
  };
}

export interface AgentPerformanceRow {
  agentName: string;
  totalSignals: number;
  correctSignals: number;
  accuracyPct: number;
  avgConfidence: number;
  brierScore: number | null;
  logLoss: number | null;
  calibrationSamples: number;
  lastUpdatedAt: string;
}

export interface AgentCostReport {
  window: { from: string; to: string };
  totals: {
    executions: number;
    markets: number;
    totalCostUsd: number;
    avgCostUsd: number | null;
    avgLlmCalls: number | null;
    avgDurationMs: number | null;
  };
  byMarket: Array<{
    marketId: string;
    marketQuestion: string | null;
    executions: number;
    costUsd: number;
    avgDurationMs: number | null;
  }>;
}

export interface OpsHealth {
  generatedAt: string;
  windowHours: number;
  queues: {
    analysis: { visible: number; inFlight: number; delayed: number; oldestMessageAgeSeconds: number | null } | null;
    deadLetter: { visible: number; inFlight: number; delayed: number; oldestMessageAgeSeconds: number | null } | null;
  };
  functions: Array<{
    name: string;
    invocations: number;
    errors: number;
    throttles: number;
    errorRate: number | null;
    avgDurationMs: number | null;
  }>;
  alarms: Array<{ name: string; state: string; updatedAt: string | null; reason: string | null }>;
  websocket: { approxConnections: number | null; note: string };
  database: { reachable: boolean; sizeBytes: number | null; connections: number | null };
}

export interface MarketScheduleRow {
  id: string;
  marketId: string;
  marketQuestion: string | null;
  intervalSeconds: number;
  nextScheduledRun: string;
  lastCompletedAt: string | null;
  lastResultId: string | null;
  isExecuting: boolean;
  executionStartedAt: string | null;
  status: string;
  updatedAt: string;
  stuck: boolean;
}

export interface MarketScheduleSummary {
  total: number;
  active: number;
  executing: number;
  stuck: number;
  dueSoon: number;
  lastCompletedAt: string | null;
}

export interface DashboardDay {
  day: string;
  signups: number;
  activeUsers: number;
  analysesExecuted: number;
  analysesDelivered: number;
  creditsConsumed: number;
  revenueUsdc: number;
  pmActiveSessions: number;
  pmRealizedPnl: number;
}

export interface DashboardSummary {
  days: DashboardDay[];
  totals: {
    signups: number;
    analysesExecuted: number;
    analysesDelivered: number;
    creditsConsumed: number;
    revenueUsdc: number;
    pmRealizedPnl: number;
  };
  stale: boolean;
}

export interface AuditEntry {
  id: string;
  actorSub: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string;
  status: "pending" | "succeeded" | "failed";
  error: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  requestId: string | null;
  createdAt: string;
  /** Chain linkage: the previous row's hash, null only for the first row ever. */
  prevHash: string | null;
  /** SHA-256 over the immutable fields. Null on a row written before the chain. */
  rowHash: string | null;
  /** SHA-256 over the terminal state (status/after/error/completedAt). */
  completionHash: string | null;
  hashVersion: number;
  completedAt: string | null;
}

/** Result of `GET /admin/audit/verify`. A broken chain still answers 200. */
export interface AuditVerification {
  valid: boolean;
  checked: number;
  from: string | null;
  to: string | null;
  head: string | null;
  firstBrokenId: string | null;
  firstBrokenReason: string | null;
  /** False when the window starts mid-chain, so its first link is unchecked. */
  coversGenesis: boolean;
  limit: number;
  verifiedAt: string;
}

export interface AuditExport {
  rows: AuditEntry[];
  truncated: boolean;
  cappedAt: number;
  exportedAt: string;
}

export interface AdminMember {
  sub: string;
  email: string;
  cognitoStatus: string;
  role: "analyst" | "support" | "admin" | "owner";
  roleRank: number;
  groups: string[];
}

export type InviteLinkStatus = "active" | "expired" | "revoked" | "exhausted";

export interface AdminInviteLink {
  id: string;
  role: AdminMember["role"];
  createdByEmail: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  useCount: number;
  redemptionCount: number;
  revokedAt: string | null;
  revokedBy: string | null;
  lastUsedAt: string | null;
  status: InviteLinkStatus;
}

export interface AdminInviteRedemption {
  id: string;
  cognitoSub: string;
  email: string;
  createdAt: string;
  cognitoStatus: string | null;
  claimed: boolean | null;
}

/** Returned exactly once, at creation: the URL is never readable again. */
export interface CreatedInviteLink {
  id: string;
  role: AdminMember["role"];
  url: string;
  expiresAt: string;
  maxUses: number;
}

export interface SupportTicketRow {
  id: string;
  ref: string;
  subject: string;
  status: "open" | "pending" | "resolved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  topic: string;
  requesterEmail: string;
  assignedAdminSub: string | null;
  createdAt: string;
  lastMessageAt: string;
  firstResponseAt: string | null;
  overdue: boolean;
  marketId: string | null;
}

export interface SupportTicketDetail extends SupportTicketRow {
  body: string;
  context: Record<string, string>;
  userId: string | null;
  assignedAt: string | null;
  confirmationSent: boolean;
  lastCustomerNotifiedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
}

export interface SupportMessage {
  id: string;
  authorType: "customer" | "admin" | "system";
  authorAdminEmail: string | null;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

export interface SupportTicketDetailPayload {
  ticket: SupportTicketDetail;
  messages: SupportMessage[];
  requester: {
    userId: string | null;
    status: string | null;
    plan: string | null;
    createdAt: string | null;
  };
  canReply: boolean;
}

export interface SupportSummary {
  open: number;
  pending: number;
  unassigned: number;
  overdue: number;
  slaHours: number;
}

export interface NewsletterPick {
  question: string;
  aiProbability: number;
  marketProbability: number;
  read: string;
  url?: string;
}

export interface ProductUpdateSection {
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

export interface ProductUpdateContent {
  heroTitle: string;
  intro: string;
  sections: ProductUpdateSection[];
  closing?: string;
}

export type NewsletterContent = MarketBriefContent | ProductUpdateContent;

export interface MarketBriefContent {
  heroTitle: string;
  intro: string;
  picks: NewsletterPick[];
  closing?: string;
}

export interface NewsletterCampaign {
  id: string;
  subject: string;
  preheader: string | null;
  template: "market_brief" | "product_update";
  content: NewsletterContent;
  status: "draft" | "sending" | "sent" | "failed" | "cancelled";
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  createdBy: string;
  approvedBy?: string | null;
  createdAt: string;
  startedAt?: string | null;
  sentAt?: string | null;
}

export interface NewsletterSummary {
  drafts: number;
  sending: number;
  sent: number;
  subscribers: number;
  unsubscribed: number;
  suppressed: number;
}

export interface NewsletterSubscriber {
  email: string;
  status: "subscribed" | "unsubscribed";
  source: string;
  userId: string | null;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  suppressedReason: string | null;
  createdAt: string;
}

// ─── Warden Copilot ───────────────────────────────────────────────────────────
//
// Read-only by construction: `suggestedActions` carries links only. There is no
// execution variant, because the copilot has no mutation path to describe.

export type CopilotKind = "incident" | "support" | "risk_brief" | "analysis" | "session";

export type CopilotCitationType =
  | "audit"
  | "ticket"
  | "analysis"
  | "session"
  | "setting"
  | "metric"
  | "runbook";

export interface CopilotCitation {
  type: CopilotCitationType;
  id: string;
  label: string;
  /** Relative portal path. Rendered with `<Link>`, never as HTML. */
  url: string;
}

export interface CopilotSuggestedAction {
  label: string;
  url: string;
  kind: "open" | "review";
}

export interface CopilotAnswer {
  answer: string;
  citations: CopilotCitation[];
  suggestedActions: CopilotSuggestedAction[];
  confidence: "high" | "medium" | "low";
  limitations: string | null;
  model: string;
  generatedAt: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
}

export interface CopilotStatus {
  enabled: boolean;
}
