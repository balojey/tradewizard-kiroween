# YouTube Description

## Title options

1. **TradeWizard - 14 AI Agents, 3 Gates, 1 Kill Switch | Kiroween 2026 (Frankenstein)**
2. **I Stitched 14 AI Agents Into a Prediction-Market Trader | Kiroween 2026**
3. **TradeWizard: An AI Hedge Fund That Knows When to Stay Out | Kiroween 2026**

Recommended: option 1.

---

## Description

**TradeWizard - an AI hedge fund for real-world outcomes, built to know when to stay out.**

Prediction markets let you trade real-world events - elections, court rulings, economic policy - but they give you markets without intelligence. TradeWizard is the missing layer: fourteen AI specialists that analyze Polymarket markets in parallel, three deterministic gates that can overrule them, and an optional autonomous Portfolio Manager bounded by hard, machine-checked limits.

Submitted to **Kiroween 2026** in the **Frankenstein** category: multi-agent inference + deterministic TypeScript + serverless AWS + on-chain payments + a Next.js terminal, stitched together with Kiro specs, steering, hooks, and MCP.

⏱️ CHAPTERS

0:00 The problem: markets without intelligence
0:18 A live market analysis
0:35 Fourteen agents, one typed signal each
0:50 The part most AI trading apps skip
1:00 Signal fusion and adversarial debate
1:20 The consensus engine and NO_TRADE
1:40 The autonomous Portfolio Manager
1:55 Guardrails and the kill switch
2:20 Serverless architecture and shared analysis
2:35 How Kiro built it
2:50 Close

🧠 THE INTELLIGENCE LAYER

• 11-stage analysis workflow
• 14 specialized agents run on every market, no router
• Per-agent isolated memory from Aurora PostgreSQL - no cross-agent anchoring
• Tools: NewsData.io, Serper search/scrape, sandboxed shell, Polymarket CLOB and Gamma APIs
• Zod-validated signals with structured fallback

🛡️ THREE DETERMINISTIC GATES (NON-LLM)

1. **Signal Fusion** - market-anchored log-odds aggregation, per-agent calibration, Brier-derived weights, evidence-scaled pass-through, standard-error noise floor
2. **Adversarial Debate** - bull and bear theses each face 5 tests: evidence, causality, timing, liquidity, tail risk
3. **Consensus Engine** - edge floor from spread + slippage, two standard errors of noise, divergence cap; fails to NO_TRADE with a machine-readable reason

🤖 AUTONOMOUS PORTFOLIO MANAGER (BOUNDED AUTONOMY)

• The agent decides; a separate executor enforces
• Read-only tool layer on the decision agent
• Mandatory stop-loss and take-profit on every position
• 50% per-session loss limit, 40% cross-session cap
• 30-minute cooldown after a loss exit
• Token ID resolved by outcome string, never array index
• Mutual exclusion between Trade Executor and Position Guard
• Kill switch fails closed - exits all positions and terminates all sessions

☁️ SERVERLESS SUBSTRATE

Lambda (Node.js 20) · Aurora PostgreSQL Serverless v2 · DynamoDB · SQS FIFO + DLQ · EventBridge · SNS fan-out · S3 · API Gateway REST + WebSocket · Cognito Magic Link · Amplify Hosting

💰 MARKET-LEVEL ANALYSIS POOL

One analysis per market per hour, shared across all users. Ten thousand requests on the same market become one execution. Users pay only for results they receive, exactly once.

🧵 BUILT WITH KIRO

• 32 specs under `.kiro/specs/` - requirements → design → tasks
• 4 steering documents: product, structure, tech, and Kiroween submission rules
• 5 hooks: typecheck each package on save, guard the deterministic gates, close out spec tasks
• MCP servers for Magic Link and Polymarket documentation

The repository is the evidence: https://github.com/balojey/tradewizard-kiroween

🏗️ BUILT WITH

Kiro · TypeScript · AWS CDK · AWS Lambda · Amazon Aurora PostgreSQL Serverless v2 · DynamoDB · SQS · SNS · EventBridge · API Gateway · Cognito · S3 · CloudWatch · Amazon Bedrock · Nebius Token Factory · Strands Agents SDK · Next.js 16 · React 19 · Tailwind CSS 4 · TanStack Query · Zod · Vitest · Remotion · Polymarket CLOB and Gamma APIs · viem · Safe · USDC.e on Polygon · Resend · NewsData.io · Serper

---

#KiroweenHackathon26 #Kiroween2026 #Kiro #PredictionMarkets #Polymarket #MultiAgentAI #AIAgents #AWSBedrock #StrandsSDK #SystemsDesign #AITrading #ServerlessArchitecture #AutonomousAgents #TypeScript #Hackathon #Frankenstein
