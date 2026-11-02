# Requirements Document

## Introduction

TradeWizard is entering Kiroween 2026 in the Frankenstein category. The product already exists as a working multi-agent prediction-market platform; this spec covers the work required to turn the existing repository into a compliant, judge-ready hackathon submission without changing product behavior.

The submission must satisfy the Kiroween rules: a public open-source repository, a detectable license, the `/.kiro` directory at the root with evidence of specs, hooks, and steering, a working app URL, a demo video under three minutes, and a written explanation of how Kiro was used.

## Glossary

- **Submission repository**: The public GitHub repository judged by Kiroween.
- **Frankenstein category**: The Kiroween category for an app that stitches together seemingly incompatible technologies.
- **Kiro artifact**: A file under `.kiro/` that records spec-driven development, steering, hooks, or MCP configuration.
- **Deterministic gate**: A non-LLM stage (signal fusion, consensus, recommendation validation, shadow consensus) that can overrule model output.
- **Submission write-up**: The text and documentation that explains the product, the build process, and Kiro usage.

## Requirements

### Requirement 1: Repository eligibility

**User Story:** As a judge, I want to clone a public repository and find everything needed to evaluate the project, so that I can verify the submission without asking the team for files.

#### Acceptance Criteria

1. THE Submission repository SHALL contain all source code, assets, and setup instructions required to run the project.
2. THE Submission repository SHALL contain an MIT license file at the root, detectable by GitHub.
3. THE Submission repository SHALL contain the `.kiro` directory at the root.
4. THE Submission repository SHALL NOT list `.kiro` or any of its subdirectories in `.gitignore`.
5. THE Submission repository SHALL NOT contain secrets, `.env` files, build output, or `node_modules`.

### Requirement 2: Category narrative

**User Story:** As a judge, I want to understand why this project belongs in the Frankenstein category, so that I can score the category fairly.

#### Acceptance Criteria

1. THE root README SHALL state the Kiroween category and the technologies being combined.
2. THE submission write-up SHALL explain each stitched layer: multi-agent inference, deterministic gates, serverless infrastructure, on-chain billing, and the frontend.
3. THE submission write-up SHALL explain what holds the layers together and why the combination is unusual.
4. THE category narrative SHALL describe only implemented behavior.

### Requirement 3: Kiro usage evidence

**User Story:** As a judge, I want to see how Kiro was used to build the project, so that I can evaluate the depth of Kiro usage.

#### Acceptance Criteria

1. THE Submission repository SHALL contain the existing `.kiro/specs/` documents with requirements, design, and tasks.
2. THE Submission repository SHALL contain the `.kiro/steering/` product, structure, and tech documents.
3. THE Submission repository SHALL contain at least one `.kiro/hooks/*.json` file that runs a real project command or agent prompt.
4. THE Submission repository SHALL contain `.kiro/settings/mcp.json` with the MCP servers used during development.
5. THE Kiro write-up SHALL describe spec-driven development, steering, hooks, and MCP with file-level references.
6. THE Kiro write-up SHALL NOT claim Kiro surfaces or techniques that lack repository evidence.

### Requirement 4: Demo and presentation

**User Story:** As a judge, I want a short demo that shows the product working end-to-end, so that I can assess usefulness, design, and presentation.

#### Acceptance Criteria

1. THE demo video SHALL be public on YouTube and shorter than three minutes.
2. THE demo video SHALL show market discovery, analysis request, agent signals, and a final recommendation or `NO_TRADE`.
3. THE demo video SHALL show the Portfolio Manager and its kill switch.
4. THE demo video SHALL show the Kiro panel with a spec, a steering file, and the hooks list.
5. THE voiceover script and YouTube description SHALL match the recorded demo.

### Requirement 5: Documentation consistency

**User Story:** As a reviewer, I want the README, Devpost write-up, and demo script to agree, so that I can trust the claims.

#### Acceptance Criteria

1. THE root README SHALL link to the submission write-up and Kiro usage document.
2. THE Devpost write-up, voiceover script, and YouTube description SHALL use the same product name, category, and feature set.
3. THE documentation SHALL describe the deterministic gates and the human-in-the-loop perimeter consistently.
4. THE documentation SHALL reference the actual commands in `infra/package.json` and `tradewizard-frontend/package.json`.
