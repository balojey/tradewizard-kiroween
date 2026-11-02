# Kiroween 2026 submission

TradeWizard is submitted to **Kiroween 2026** in the **Frankenstein** category.

## Submission constants

- Public repo: `tradewizard-kiroween`
- Category: Frankenstein - a chimera of multi-agent inference, deterministic TypeScript gates, serverless AWS, an on-chain payment rail, and a Next.js trading terminal.
- License: MIT (`LICENSE` at repo root, visible in GitHub's About section).
- Demo video: public YouTube URL, under three minutes, shows the real app.
- The `/.kiro` directory is a submission artifact. Never add it to `.gitignore`.

## Writing rules

- Every technical claim must be traceable to code, a `.kiro/specs/` document, or a deployed stack. Do not describe planned features in the present tense.
- Keep the Frankenstein frame concrete: name the technologies being stitched and the seam that holds them together (Kiro specs + steering + hooks).
- Product docs live in `README.md`, `docs/kiroween-submission.md`, and `docs/kiro-usage.md`. Keep them consistent when behavior changes.
- The deterministic stages (`signal-fusion`, `consensus-engine`, `recommendation`, `shadow-consensus`) are the safety story. Never describe them as model behavior.
- Do not claim Kiro Crew, CLI, Web, powers, or property-based testing unless the repository contains evidence of that use.

## Demo rules

- Open on the problem, not a logo.
- Show: market discovery → request analysis → 14 agent signals → thesis/debate → final recommendation or `NO_TRADE` → Portfolio Manager kill switch.
- Show the Kiro panel once: a spec, a steering file, and the Agent Hooks list.
- End on the refusal story: "the system is built to know when to stay out."
