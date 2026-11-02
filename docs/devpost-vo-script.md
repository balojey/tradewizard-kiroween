# TradeWizard - Kiroween 2026 Demo Script

**Target runtime:** 2:45 · **Hard cap:** 3:00
**Category:** Frankenstein
**Tone:** Calm, technical, slightly ominous. Halloween framing without costume props.

---

## Shot list

| Time | On screen | Action |
|------|-----------|--------|
| 0:00 | Title card / market grid | Open on the problem, not a logo. Slow push into the live markets view. |
| 0:18 | Markets page | Hover a live Polymarket market, open it. |
| 0:28 | Market detail | Click **Analyze**. Show the credit balance decrement. |
| 0:35 | Analysis progress | Show agents reporting in; keep the agent grid visible. |
| 0:50 | Results - agent signals | Scroll the fourteen signals. Pause on two that disagree. |
| 1:00 | Results - thesis / debate | Show bull and bear theses and the cross-examination scores. |
| 1:20 | Results - final recommendation | Show entry, target, stop, EV, confidence. Then cut to a `NO_TRADE` example with its reason. |
| 1:40 | Portfolio Manager | Open the session activation form; show persona, capital, guardrails. |
| 1:55 | Portfolio dashboard | Show an open position, stop-loss, take-profit, and the kill switch. |
| 2:10 | Kill switch confirmation | Show the fail-closed copy. Do not actually execute unless using a demo account. |
| 2:20 | Architecture / terminal | Optional cut to a simple architecture overlay. |
| 2:35 | Kiro panel | Open one spec, one steering file, and the Agent Hooks list. |
| 2:45 | End card | Product name + repo URL. |

---

## Full version (≈ 2:45)

Prediction markets turn the world's information into a single number: a probability. In theory, anyone can trade them. In practice, almost nobody can trade them well. Pricing an outcome means doing five jobs at once - news, polling, order flow, narrative, and timing. TradeWizard does those five jobs, then refuses to trade when the evidence does not hold.

We built it for Kiroween's Frankenstein category, because it is genuinely stitched together: fourteen AI specialists, three deterministic gates, a serverless AWS backend, an on-chain payment rail, and this Next.js terminal. The stitching is Kiro.

I pick a live Polymarket market and request an analysis. Fourteen agents run in parallel - microstructure, news, polling, sentiment, momentum, tail risk. Each returns a typed signal.

Then comes the part most AI trading apps skip: three deterministic gates. Signal fusion de-biases each agent against its own calibration and weights it by historical accuracy. A bull and a bear thesis each face five adversarial tests. The consensus engine applies an edge floor from spread and slippage, two standard errors of noise, and a divergence cap. If disagreement crosses thirty percent, or expected value is not positive, the answer is no trade - with a reason code, not a vibe.

That refusal is the product. A system that always answers teaches you to stop thinking.

When the evidence holds, the recommendation carries an entry zone, a target, a mandatory stop-loss, expected value, and the full reasoning chain.

For Pro and Elite there is the Portfolio Manager. I choose the market, the capital, and a persona. The agent can decide, but it cannot place an order. A separate executor enforces mandatory stop-loss and take-profit, loss caps, cooldowns, and this kill switch, which exits everything and fails closed.

Under the hood: Lambda, Aurora, DynamoDB, SQS, and SNS. One analysis per market is shared across users, so cost scales with markets, not traffic. Every recommendation is scored after it resolves, and every agent's accuracy feeds back into the next analysis.

Kiro built it with us. Thirty-two specs, four steering documents, five hooks that typecheck each package and guard the deterministic gates, and MCP servers for the Polymarket and Magic Link docs.

Fourteen specialists. Three gates. One kill switch. TradeWizard - an AI hedge fund for real-world outcomes, built to know when to stay out.

---

## Short version (≈ 75s)

Prediction markets turn the world's information into a probability. Almost nobody trades them well, because pricing an outcome means doing five jobs at once. TradeWizard does those five jobs with fourteen AI specialists, then refuses to trade when the evidence does not hold.

It is our Kiroween Frankenstein build: fourteen agents, three deterministic gates, a serverless AWS backend, an on-chain payment rail, and a Next.js terminal - stitched together with Kiro.

The agents return typed signals. Fusion calibrates and weights them. Bull and bear theses face ten adversarial tests. The consensus engine applies an edge floor, a noise floor, and a divergence cap. If disagreement crosses thirty percent, or expected value is not positive, the answer is no trade, with a reason code.

When the evidence holds, the recommendation includes entry, target, mandatory stop, expected value, and the full reasoning chain.

For Pro and Elite, the Portfolio Manager executes inside guardrails the user pre-approves. The agent decides. A separate executor enforces. The kill switch fails closed.

Kiro gave us thirty-two specs, four steering documents, and five hooks that protect the gates.

Fourteen specialists. Three gates. One kill switch. TradeWizard - built to know when to stay out.
