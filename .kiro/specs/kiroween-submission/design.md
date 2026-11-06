# Design Document

## Overview

The submission is a documentation and packaging layer over the existing TradeWizard product. No analysis, execution, or billing behavior changes. The design has four parts:

1. **Repository hygiene** - copy the working tree without build artifacts, add an MIT license, confirm `.kiro` is tracked.
2. **Kiro evidence** - keep the 31 existing specs and 3 steering documents, add five hooks, and document the MCP configuration.
3. **Narrative** - recast the product as a Frankenstein build in the root README and a dedicated submission write-up.
4. **Presentation** - rewrite the voiceover script and YouTube description around a sub-three-minute demo, and add a Devpost checklist.

## Architecture of the submission

```
tradewizard-kiroween/
├── LICENSE                               # MIT, detected by GitHub
├── README.md                             # product + Kiroween framing + quick start
├── .kiro/
│   ├── specs/                            # 34 specs; requirements → design → tasks
│   ├── steering/                         # product, structure, tech, kiroween
│   ├── hooks/                            # 5 functional hooks
│   └── settings/mcp.json                 # Magic Link + Polymarket docs MCP
├── docs/
│   ├── kiroween-submission.md            # Devpost text description
│   ├── kiro-usage.md                     # judge-facing Kiro write-up
│   ├── devpost-submission.md             # long-form product story
│   ├── devpost-vo-script.md              # <3 min voiceover
│   └── youtube-description.md            # video metadata
├── infra/                                # CDK + Lambda backend
├── tradewizard-frontend/                 # Next.js product UI
├── tradewizard-admin/                    # internal management portal
└── remotion/                             # demo video compositions
```

## Key decisions

### Category: Frankenstein

The product is a genuine chimera: model inference from multiple providers, deterministic TypeScript gates that overrule the models, a serverless AWS substrate, on-chain payments on Polygon, and a Next.js terminal. The category claim is defensible without changing the product.

### Kiro evidence over invented history

The repository already contains 33 product specs, 3 steering documents, and MCP configuration. The submission adds hooks that run real commands and a steering document that encodes the submission rules. The Kiro write-up describes only these artifacts and does not claim Crew, CLI, Web, powers, or property-based testing.

### Hooks

| Hook | Trigger | Action | Why |
|------|---------|--------|-----|
| `infra-typecheck` | `PostFileSave` on `infra/**/*.ts` | `tsc --noEmit` | Catch backend type drift before deploy |
| `frontend-typecheck` | `PostFileSave` on frontend TS/TSX | `tsc --noEmit` | The frontend has no test runner; typecheck is the safety net |
| `admin-typecheck` | `PostFileSave` on admin TS/TSX | `tsc --noEmit` | Keep the separate admin package honest |
| `analysis-gate-guard` | `PostFileSave` on gate files | Agent prompt | Preserve determinism and NO_TRADE reasons |
| `spec-task-followthrough` | `PostTaskExec` | Agent prompt | Close the loop between tasks.md and the code |

### License

MIT with `Copyright (c) 2026 TradeWizard`. Required for Kiroween eligibility and consistent with the project's intent to publish the source for judging.

### Demo

The existing Remotion compositions render product UI sequences at 1600×1000 and 900×1125. The final demo is a screen recording of the live app, optionally intercut with Remotion clips. The script allocates:

- 0:00–0:20 problem and category
- 0:20–0:50 market discovery and analysis request
- 0:50–1:35 agent signals, debate, deterministic gates
- 1:35–2:20 Portfolio Manager and kill switch
- 2:20–2:50 Kiro evidence and close

## Risks

- **Stale docs**: the repo's READMEs are partially stale. The submission docs use `.kiro/steering/` and current code as the source of truth.
- **Model claims drift**: model IDs are environment-driven. The submission docs describe capability routing rather than naming every model.
- **Overclaiming Kiro**: the write-up is limited to artifacts a judge can inspect.
- **Demo length**: the script is timed to 2:50 to leave margin under the three-minute cap.
