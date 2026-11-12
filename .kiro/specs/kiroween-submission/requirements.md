# Requirements Document

## Introduction

The Kiroween 2026 submission is the **TradeWizard Warden**, a separate internal control plane for a live multi-agent prediction-market platform. The platform predates the submission and is context only; the portal is the new artifact built during the submission period.

This spec covers the submission packaging: the repository eligibility, the portal-first narrative, the Devpost entry, the demo, the Kiro evidence, and consistency across the documents.

## Glossary

- **Portal**: The `tradewizard-admin/` Next.js application plus the admin API, authorizer, audit, settings, support, and newsletter surfaces.
- **Platform**: The customer-facing TradeWizard product the portal operates.
- **Devpost entry**: `docs/devpost-submission.md`, the canonical text pasted into Devpost.
- **Kiro evidence**: The specs, steering, hooks, and MCP configuration a judge can inspect.
- **Submission period**: The Kiroween 2026 window; only the portal is claimed as new work.

## Requirements

### Requirement 1: Portal as the submitted project

**User Story:** As a judge, I want to know exactly what was built for this submission, so that I can evaluate the new work without confusing it with the existing platform.

#### Acceptance Criteria

1. THE README SHALL name **TradeWizard Warden** as the submitted project.
2. THE Submission SHALL describe the platform as context, not as new work.
3. THE Submission SHALL NOT claim the fourteen-agent platform, the customer frontend, or the billing rail as built during the submission period.
4. THE Submission SHALL identify the four portal specs as the primary Kiro artifacts.
5. THE Submission SHALL link the live portal at `https://admin.tradewizard.live` and the platform at `https://tradewizard.live`.

### Requirement 2: Repository eligibility

**User Story:** As a judge, I want to clone a public repository and find everything needed to evaluate the portal.

#### Acceptance Criteria

1. THE Repository SHALL contain all portal source, assets, and setup instructions.
2. THE Repository SHALL contain an MIT license at the root.
3. THE Repository SHALL contain `.kiro/` at the root, not gitignored.
4. THE Repository SHALL NOT contain secrets, `.env` files, build output, or `node_modules`.
5. THE Repository SHALL NOT contain the old beta site as a submission artifact.

### Requirement 3: Devpost entry

**User Story:** As a judge, I want a clear project description in the format Devpost expects.

#### Acceptance Criteria

1. `docs/devpost-submission.md` SHALL follow the Devpost section order: Inspiration, What it does, Why this is a Frankenstein, How we built it with Kiro, How it works, Challenges, Accomplishments, What we learned, What's next, Kiro usage, Built with, Links.
2. THE Entry SHALL be under 5,000 words.
3. THE Entry SHALL use absolute GitHub links for all repository references.
4. THE Entry SHALL NOT mention Nebius.
5. THE Entry SHALL describe the portal's auth, RBAC, audit, read surfaces, controls, runtime settings, support, newsletter, and PWA cache policy.
6. THE Entry SHALL include the AWS service map used by the portal.

### Requirement 4: Demo

**User Story:** As a judge, I want a short demo that shows the portal working end-to-end.

#### Acceptance Criteria

1. THE Demo SHALL be public on YouTube and under three minutes.
2. THE Demo SHALL open on the portal, not the platform or the old beta site.
3. THE Demo SHALL show login/TOTP, overview, users, analyses, a portfolio session, the kill switch, runtime settings, audit, support, and newsletter.
4. THE Demo SHALL mention the platform only as the system the portal operates.
5. THE Demo SHALL show the four Kiro specs, steering, and hooks.
6. THE Demo SHALL show the read-only Ask Warden copilot and its citations.
6. THE Voiceover script and YouTube description SHALL match the recorded demo.

### Requirement 5: Kiro evidence

**User Story:** As a judge, I want to see how Kiro was used to build the portal.

#### Acceptance Criteria

1. THE Repository SHALL contain `admin-portal-foundation` and `admin-portal-operations` with requirements, design, and tasks.
2. THE Repository SHALL contain four steering documents and five hooks.
3. THE Repository SHALL contain `fast-check` property tests for the portal's authorization invariants.
4. `docs/kiro-usage.md` SHALL describe the portal specs, steering, hooks, MCP, property-based tests, and honest scope.
5. THE Write-up SHALL NOT claim Kiro surfaces or techniques without repository evidence.

### Requirement 6: Documentation consistency

**User Story:** As a reviewer, I want the README, Devpost entry, form pack, and video to agree.

#### Acceptance Criteria

1. THE README SHALL link the portal docs, the four portal specs, and the Kiro write-up.
2. THE Devpost form pack SHALL name the portal, provide the live URL, and list demo credentials as `TODO`.
3. THE Video script, YouTube description, and form pack SHALL use the same portal narrative.
4. THE Word count in the README and form pack SHALL match `docs/devpost-submission.md`.
