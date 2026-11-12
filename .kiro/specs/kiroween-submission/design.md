# Design Document

## Overview

The submission is a documentation and packaging layer around the existing Warden. No product or portal behavior changes. The design has five parts:

1. **Framing** - the portal is the new artifact; the platform is context.
2. **Canonical documents** - one Devpost entry, one internal write-up, one Kiro evidence document.
3. **Video** - a portal-first demo under three minutes.
4. **Repository eligibility** - license, `.kiro`, no secrets, no old beta artifact.
5. **Consistency** - the README, form pack, script, and YouTube description agree.

## Canonical document map

```
docs/
├── devpost-submission.md      # Canonical Devpost entry (under 5,000 words, absolute links)
├── kiroween-submission.md     # Internal category write-up
├── kiro-usage.md              # Judge-facing Kiro evidence
├── devpost-form.md            # Form fields, test instructions, checklist
├── devpost-vo-script.md       # Portal demo shot list + voiceover
├── youtube-description.md     # Title, description, chapters
├── admin-portal-architecture.md
└── admin-portal-runbook.md
```

`README.md` is portal-first. It names the portal as the submission, describes the portal, and keeps the platform in a short context section.

## Portal-first framing

### What is claimed as new

- The `tradewizard-admin/` Next.js application
- The admin API, authorizer, and audit spine
- The four-role RBAC and MFA flow
- The kill switch, session controls, account operations, and analysis operations
- Runtime settings with named consumers
- The support inbox and newsletter operations
- The PWA cache policy
- The four Kiro specs that define the portal

### What is context

- The fourteen-agent analysis pipeline
- The customer frontend
- On-chain billing and the Portfolio Manager
- The platform's data model and existing services

The entry must not imply the platform was built during the submission period.

## Devpost entry

`docs/devpost-submission.md` follows the Devpost section order and includes:

- The problem: operating a live trading platform from the console is unsafe
- The portal: observe, control, configure, account
- Why Frankenstein: the stitched technologies and the contract between them
- How Kiro built it: the four specs, steering, hooks, MCP
- How it works: auth, RBAC, audit, kill switch, settings, support, newsletter, PWA, AWS map
- Challenges, accomplishments, lessons, next steps
- Kiro usage summary, built-with list, links

Constraints: under 5,000 words, absolute links, no Nebius, no old beta site.

## Video

Target 2:45, hard cap 3:00.

| Time | Beat |
|------|------|
| 0:00 | Portal login; the problem |
| 0:08 | TOTP and role enforcement |
| 0:20 | Overview |
| 0:32 | Users |
| 0:45 | Analyses |
| 1:00 | Portfolio session |
| 1:10 | Kill switch |
| 1:25 | Runtime settings and audit |
| 1:40 | Support |
| 1:55 | Newsletter |
| 2:10 | Audit + RBAC |
| 2:25 | PWA + Kiro artifacts |
| 2:45 | Close |

The platform appears only as the system being operated. The old beta site is not shown.

## Kiro evidence

- `admin-portal-foundation` and `admin-portal-operations` specs
- Four steering documents
- Five hooks, including `admin-typecheck`, `analysis-gate-guard`, and `spec-task-followthrough`
- Two active MCP servers
- `fast-check` property tests for role ranking, group resolution, `requireRole`, fresh-auth, and bearer extraction
- Example-based Vitest coverage for the remaining portal behavior

## Risks

- **Overclaiming the platform**: the entry must keep the platform in context.
- **Eligibility**: only the portal is claimed as new work.
- **Word limit**: the canonical entry must stay under 5,000 words.
- **Old beta artifact**: do not link or show it.
- **Duplicate docs**: `devpost-submission.md` is canonical; `kiroween-submission.md` is internal.
