# YouTube Description

## Title options

1. **TradeWizard Warden - The Audited Control Plane + Read-Only AI Copilot | Kiroween 2026**
2. **I Built the Control Plane for a Live Prediction-Market Platform | Kiroween 2026**
3. **TradeWizard Warden: Kill Switch, Audit Log, and 4-Role RBAC | Kiroween 2026**

Recommended: option 1.

---

## Description

**The audited control surface for a live multi-agent prediction-market platform.**

TradeWizard is live: fourteen AI agents, a deterministic analysis pipeline, an autonomous Portfolio Manager, on-chain billing, support, and a newsletter. Warden is the separate internal product built to operate it safely.

It is not a CRUD dashboard. It is a role-gated control plane with its own Next.js app, API, Cognito identity, hash-chained audit trail, runtime settings, and deployment. It never holds wallet keys, signs transactions, or calls the CLOB.

It also has **Ask Warden**, a read-only AI copilot. It answers incident, support, analysis, session, and risk questions with citations to the exact record — and every suggestion is a link, never an action.

**Submitted to Kiroween 2026 in the Frankenstein category.** The portal stitches together Next.js, Cognito, API Gateway, Lambda, RDS PostgreSQL, DynamoDB, S3, EventBridge, SNS, CloudWatch, Amplify, a conservative PWA, and four Kiro specs.

- **Operations portal:** https://warden.tradewizard.live
- **Platform it operates:** https://tradewizard.live
- **Repository:** https://github.com/balojey/tradewizard-kiroween
- **Kiro usage write-up:** https://github.com/balojey/tradewizard-kiroween/blob/main/docs/kiro-usage.md

⏱️ CHAPTERS

0:00 The portal and the problem
0:08 Sign-in, TOTP, and role enforcement
0:20 Operational overview
0:32 Users, credits, plans, and notes
0:45 Analysis quality, requeue, and refunds
1:00 Portfolio sessions and decisions
1:10 The fail-closed kill switch
1:25 Runtime settings with real consumers
1:40 Support inbox
1:55 Ask Warden with citations
2:10 Newsletter composer and subscribers
2:20 Hash-chained audit and RBAC
2:30 PWA cache safety and Kiro artifacts
2:45 Close

🔐 AUTHENTICATION AND AUTHORIZATION

• Separate Cognito admin app client: email + password + TOTP
• Self-service MFA enrolment with QR code
• Four cumulative roles: analyst, support, admin, owner
• Request authorizer reads live Cognito group membership, not the token snapshot
• Warden-only `+warden` aliases; the product refuses `+tag` addresses
• Role-carrying invite links with expiry, use caps, and one-click revoke
• Destructive actions require a token fresher than 10 minutes
• The last owner cannot be removed (`409 LAST_OWNER`)

📜 HASH-CHAINED AUDIT

• Audit row written before the side effect
• Actor, action, target, reason, before/after state, request id, IP, user agent
• `prev_hash` + `row_hash` link every row to its predecessor
• Terminal rows add `completion_hash`, so a flipped status is detectable
• Advisory lock prevents a chain fork; unique hash is the backstop
• `GET /admin/audit/verify` names the first broken row
• Database triggers reject updates and deletes
• Pending rows make crashes visible

🎛️ OPERATIONAL CONTROLS

• Fail-closed per-user kill switch: synchronous halt, asynchronous exit
• Session pause/resume/terminate
• Credits, plan overrides, account status, support notes
• Analysis cache invalidation, refunds, market requeue
• Runtime settings with a named consumer each
• Support ticket inbox with context snapshots
• Newsletter campaigns, subscribers, and suppression

🤖 ASK WARDEN (READ-ONLY)

• Incident, support, analysis, session, and risk questions
• Deterministic retrieval; one tool-less model call
• Every factual claim cites the exact record
• Role-scoped: analyst, support, admin, owner
• Suggested actions are links, never executions
• No mutation route, no tool loop, no `execute`
• `copilot_enabled` kill switch and per-operator daily cap

🧵 BUILT WITH KIRO

• `admin-portal-foundation` spec: package isolation, auth/MFA, RBAC, audit, admin API, read surfaces, shell
• `admin-portal-operations` spec: mutation envelope, kill switch, session controls, membership, settings, support, newsletter
• `audit-chain-integrity` spec: canonical hashes, backfill, bounded verification, audit UI
• `admin-copilot` spec: read-only retrieval, citations, role scoping, no execution path
• 4 steering documents and 5 hooks
• `fast-check` property tests for RBAC, fresh-auth, and bearer extraction
• MCP servers for Magic Link and Polymarket documentation

🏗️ BUILT WITH

Kiro · TypeScript · Next.js 16 · React 19 · Tailwind CSS 4 · TanStack Query · Amazon Cognito · API Gateway · AWS Lambda · Amazon RDS for PostgreSQL · Amazon DynamoDB · Amazon S3 · Amazon EventBridge · Amazon SNS · Amazon CloudWatch · AWS Secrets Manager · AWS IAM · AWS Amplify Hosting · AWS CDK · Amazon Bedrock · Zod · Vitest · Remotion

Platform context: Strands Agents SDK · Polymarket CLOB and Gamma APIs · viem · Safe · USDC.e on Polygon · Resend · NewsData.io · Serper

---

#KiroweenHackathon26 #Kiroween2026 #Kiro #OperationsPortal #AdminPortal #AICopilot #ReadOnlyAI #RBAC #AuditLog #AWS #Serverless #NextJS #TypeScript #Hackathon #Frankenstein
