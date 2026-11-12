# Kiroween 2026 submission

The Kiroween 2026 submission is **TradeWizard Warden**, in the **Frankenstein** category.

The platform the portal operates is context. The portal is the new artifact. Do not describe the whole TradeWizard platform as newly built for this submission.

## Submission constants

- Public repo: `tradewizard-kiroween`
- Project name: **TradeWizard Warden**
- Category: Frankenstein - a separate internal control plane stitched from Next.js, Cognito, API Gateway, Lambda, RDS, DynamoDB, S3, EventBridge, SNS, CloudWatch, Amplify, a conservative PWA, and four Kiro specs.
- License: MIT (`LICENSE` at repo root, visible in GitHub's About section).
- Live portal: `https://admin.tradewizard.live`
- Platform context: `https://tradewizard.live`
- Demo video: public YouTube URL, under three minutes, shows the portal working end-to-end.
- The `/.kiro` directory is a submission artifact. Never add it to `.gitignore`.

## Writing rules

- Every technical claim must be traceable to code, a `.kiro/specs/` document, or a deployed stack.
- The portal is a control surface. It never holds wallet keys, signs transactions, or calls the CLOB.
- The platform is context. Never imply the entire platform was built during the submission period.
- Keep the Frankenstein frame concrete: name the technologies being stitched and the seam that holds them together (Kiro specs + steering + hooks).
- Do not mention Nebius in the Devpost submission.
- The canonical Devpost entry is `docs/devpost-submission.md`. It must follow the Devpost section order, use absolute links, and stay under 5,000 words.
- `docs/kiroween-submission.md` is the internal category write-up. `docs/kiro-usage.md` is the judge-facing Kiro evidence.
- Do not claim Kiro Crew, CLI, Web, powers, or property-based testing unless the repository contains evidence of that use.

## Demo rules

- Open on the portal, not the platform.
- Show: login/TOTP → overview → users → analyses → portfolio session and kill switch → runtime settings → audit → support → newsletter → Kiro specs/hooks.
- Mention the platform only as the system the portal operates.
- Do not show or link the old beta site.
- End on the control-plane story: "The platform is the product. This is the control plane."
