/**
 * Newsletter renderer.
 *
 * Preview, test sends, production sends and the public web view all go through
 * this module, so the composer cannot lie about what the inbox receives.
 *
 * Design: warm paper canvas, one accent rule, serif headlines, tabular numbers
 * for probabilities, and market bars built from table cells rather than images —
 * it must read correctly with images blocked, in Outlook, and in dark mode.
 */

import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { render } from '@react-email/render';
import type {
  MarketBriefContent,
  NewsletterContent,
  NewsletterTemplate,
  ProductUpdateContent,
} from './newsletter-content';

const COLORS = {
  canvas: '#f1eee7',
  card: '#fffdf8',
  ink: '#14120e',
  body: '#3b352b',
  muted: '#6f6759',
  rule: '#e3ddd0',
  accent: '#4b3fd4',
  rail: '#ece7dc',
  yes: '#16794c',
  no: '#b02a1f',
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',Times,serif";
const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";

export interface NewsletterRenderInput {
  template: NewsletterTemplate;
  content: NewsletterContent;
  subject: string;
  preheader?: string | null;
  recipientName?: string | null;
  unsubscribeUrl: string;
  /** Public web view link, when the issue has one. */
  webViewUrl?: string | null;
  issueDate?: string;
}

export async function renderNewsletter(
  input: NewsletterRenderInput
): Promise<{ html: string; text: string }> {
  const html = await render(<NewsletterDocument {...input} />);
  const greeting = greetingFor(input.recipientName);

  const text =
    input.template === 'market_brief'
      ? marketBriefText(input.content as MarketBriefContent, greeting, input)
      : productUpdateText(input.content as ProductUpdateContent, greeting, input);

  return { html, text };
}

/** Backwards-compatible alias used by earlier slices' tests. */
export const renderMarketBrief = renderNewsletter;

function NewsletterDocument(props: NewsletterRenderInput) {
  const { content, preheader, issueDate, unsubscribeUrl, webViewUrl } = props;
  const heroTitle = (content as MarketBriefContent).heroTitle;

  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{preheader || heroTitle}</Preview>

      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={topRule} />

          <Section style={brandRow}>
            <Text style={wordmarkStyle}>TradeWizard</Text>
            <Text style={issueTagStyle}>
              THE WEEKLY BRIEF{issueDate ? ` · ${issueDate}` : ''}
            </Text>
          </Section>

          <Text style={greetingStyle}>{greetingFor(props.recipientName)}</Text>

          {props.template === 'market_brief' ? (
            <MarketBriefBody content={content as MarketBriefContent} />
          ) : (
            <ProductUpdateBody content={content as ProductUpdateContent} />
          )}

          <Footer
            unsubscribeUrl={unsubscribeUrl}
            webViewUrl={webViewUrl ?? null}
          />
        </Container>
      </Body>
    </Html>
  );
}

function MarketBriefBody({ content }: { content: MarketBriefContent }) {
  return (
    <>
      <Heading style={heroStyle}>{content.heroTitle}</Heading>
      <Text style={introStyle}>{content.intro}</Text>

      <Section style={ruleStyle} />

      {content.picks.map((pick, index) => (
        <MarketPick key={`${pick.question}-${index}`} pick={pick} />
      ))}

      {content.closing ? <Text style={closingStyle}>{content.closing}</Text> : null}
    </>
  );
}

function ProductUpdateBody({ content }: { content: ProductUpdateContent }) {
  return (
    <>
      <Heading style={heroStyle}>{content.heroTitle}</Heading>
      <Text style={introStyle}>{content.intro}</Text>

      <Section style={ruleStyle} />

      {content.sections.map((section, index) => (
        <Section key={`${section.heading}-${index}`} style={cardStyle}>
          <Heading as="h3" style={questionStyle}>
            {section.heading}
          </Heading>
          <Text style={readStyle}>{section.body}</Text>

          {section.ctaLabel && section.ctaUrl ? (
            <Link href={section.ctaUrl} style={ctaStyle}>
              {section.ctaLabel} →
            </Link>
          ) : null}
        </Section>
      ))}

      {content.closing ? <Text style={closingStyle}>{content.closing}</Text> : null}
    </>
  );
}

function MarketPick({ pick }: { pick: MarketBriefContent['picks'][number] }) {
  const edge = pick.aiProbability - pick.marketProbability;
  const edgeLabel = `${edge > 0 ? '+' : ''}${edge.toFixed(0)} pts`;
  const edgeColor = edge > 0 ? COLORS.yes : edge < 0 ? COLORS.no : COLORS.muted;

  return (
    <Section style={cardStyle}>
      <Text style={pickLabelStyle}>MARKET</Text>
      <Heading as="h3" style={questionStyle}>
        {pick.question}
      </Heading>

      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={barTable}>
        <tbody>
          <tr>
            <td style={barTrack}>
              <table
                role="presentation"
                width={`${Math.max(2, Math.min(100, pick.aiProbability))}%`}
                cellPadding={0}
                cellSpacing={0}
              >
                <tbody>
                  <tr>
                    <td style={barFill} />
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
        <tbody>
          <tr>
            <td style={statCell}>
              <Text style={statLabel}>AI fair</Text>
              <Text style={{ ...statValue, color: COLORS.accent }}>
                {Math.round(pick.aiProbability)}%
              </Text>
            </td>
            <td style={statCell}>
              <Text style={statLabel}>Market</Text>
              <Text style={statValue}>{Math.round(pick.marketProbability)}%</Text>
            </td>
            <td style={{ ...statCell, textAlign: 'right' as const }}>
              <Text style={statLabel}>Edge</Text>
              <Text style={{ ...statValue, color: edgeColor }}>{edgeLabel}</Text>
            </td>
          </tr>
        </tbody>
      </table>

      <Text style={readStyle}>{pick.read}</Text>

      {pick.url ? (
        <Link href={pick.url} style={ctaStyle}>
          Open the analysis →
        </Link>
      ) : null}
    </Section>
  );
}

function Footer({
  unsubscribeUrl,
  webViewUrl,
}: {
  unsubscribeUrl: string;
  webViewUrl: string | null;
}) {
  return (
    <Section style={footerStyle}>
      <Text style={footerTextStyle}>
        You are receiving this because you asked for The Weekly Brief. It is separate
        from your analysis alerts.
      </Text>
      <Text style={footerTextStyle}>
        <Link href={unsubscribeUrl} style={footerLinkStyle}>
          Unsubscribe
        </Link>
        {' · '}
        <Link href="https://tradewizard.live/account" style={footerLinkStyle}>
          Email preferences
        </Link>
        {webViewUrl ? (
          <>
            {' · '}
            <Link href={webViewUrl} style={footerLinkStyle}>
              View in browser
            </Link>
          </>
        ) : null}
      </Text>
      <Text style={footerFineStyle}>
        {process.env.NEWSLETTER_POSTAL_ADDRESS || 'TradeWizard · tradewizard.live'}
        <br />
        Analysis is research, not financial advice.
      </Text>
    </Section>
  );
}

// ─── Plain text ───────────────────────────────────────────────────────────────

function marketBriefText(
  content: MarketBriefContent,
  greeting: string,
  input: NewsletterRenderInput
): string {
  return [
    greeting,
    '',
    content.heroTitle,
    '',
    content.intro,
    '',
    ...content.picks.flatMap((pick) => [
      `— ${pick.question}`,
      `AI ${pick.aiProbability}% · market ${pick.marketProbability}%`,
      pick.read,
      pick.url ?? '',
      '',
    ]),
    content.closing ?? '',
    '',
    ...footerLines(input),
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

function productUpdateText(
  content: ProductUpdateContent,
  greeting: string,
  input: NewsletterRenderInput
): string {
  return [
    greeting,
    '',
    content.heroTitle,
    '',
    content.intro,
    '',
    ...content.sections.flatMap((section) => [
      `— ${section.heading}`,
      section.body,
      section.ctaUrl ? `${section.ctaLabel ?? 'Open'}: ${section.ctaUrl}` : '',
      '',
    ]),
    content.closing ?? '',
    '',
    ...footerLines(input),
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

function footerLines(input: NewsletterRenderInput): string[] {
  return [
    'You are receiving this because you asked for The Weekly Brief.',
    `Unsubscribe: ${input.unsubscribeUrl}`,
    ...(input.webViewUrl ? [`View in browser: ${input.webViewUrl}`] : []),
    '',
    'TradeWizard · tradewizard.live',
    'Not financial advice.',
  ];
}

function greetingFor(name: string | null | undefined): string {
  return name?.trim() ? `Hi ${name.trim()},` : 'Hi there,';
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const bodyStyle: React.CSSProperties = {
  margin: 0,
  padding: '32px 12px',
  backgroundColor: COLORS.canvas,
  fontFamily: FONT,
};

const containerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '600px',
  margin: '0 auto',
  backgroundColor: COLORS.card,
  border: `1px solid ${COLORS.rule}`,
  borderRadius: '14px',
  padding: '0 28px 28px',
};

const topRule: React.CSSProperties = {
  height: '4px',
  backgroundColor: COLORS.accent,
  borderRadius: '14px 14px 0 0',
  margin: '0 -28px 22px',
};

const brandRow: React.CSSProperties = { marginBottom: '18px' };

const wordmarkStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: SERIF,
  fontSize: '17px',
  fontWeight: 700,
  letterSpacing: '-0.01em',
  color: COLORS.ink,
};

const issueTagStyle: React.CSSProperties = {
  margin: '2px 0 0',
  fontFamily: MONO,
  fontSize: '10px',
  letterSpacing: '0.14em',
  color: COLORS.muted,
};

const greetingStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: '14px',
  color: COLORS.body,
};

const heroStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontFamily: SERIF,
  fontSize: '30px',
  lineHeight: '1.15',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  color: COLORS.ink,
};

const introStyle: React.CSSProperties = {
  margin: '0 0 20px',
  fontSize: '15px',
  lineHeight: '1.7',
  color: COLORS.body,
};

const ruleStyle: React.CSSProperties = {
  borderTop: `1px solid ${COLORS.rule}`,
  margin: '0 0 20px',
};

const cardStyle: React.CSSProperties = {
  border: `1px solid ${COLORS.rule}`,
  borderRadius: '10px',
  backgroundColor: '#ffffff',
  padding: '18px 18px 16px',
  margin: '0 0 14px',
};

const pickLabelStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontFamily: MONO,
  fontSize: '9.5px',
  letterSpacing: '0.16em',
  color: COLORS.muted,
};

const questionStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontFamily: SERIF,
  fontSize: '19px',
  lineHeight: '1.3',
  fontWeight: 700,
  color: COLORS.ink,
};

const barTable: React.CSSProperties = { marginBottom: '8px' };
const barTrack: React.CSSProperties = {
  backgroundColor: COLORS.rail,
  borderRadius: '3px',
  height: '6px',
};
const barFill: React.CSSProperties = {
  backgroundColor: COLORS.accent,
  borderRadius: '3px',
  height: '6px',
  lineHeight: '6px',
  fontSize: '0',
};

const statCell: React.CSSProperties = {
  verticalAlign: 'top',
  padding: '6px 0 2px',
};

const statLabel: React.CSSProperties = {
  margin: '0 0 2px',
  fontSize: '10px',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: COLORS.muted,
};

const statValue: React.CSSProperties = {
  margin: 0,
  fontFamily: MONO,
  fontSize: '16px',
  fontWeight: 700,
  color: COLORS.ink,
};

const readStyle: React.CSSProperties = {
  margin: '10px 0 12px',
  fontSize: '13.5px',
  lineHeight: '1.65',
  color: COLORS.body,
};

const ctaStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: COLORS.accent,
  textDecoration: 'none',
};

const closingStyle: React.CSSProperties = {
  margin: '18px 0 4px',
  fontSize: '14px',
  lineHeight: '1.7',
  color: COLORS.body,
};

const footerStyle: React.CSSProperties = {
  borderTop: `1px solid ${COLORS.rule}`,
  marginTop: '24px',
  paddingTop: '16px',
};

const footerTextStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: '11px',
  lineHeight: '1.6',
  color: COLORS.muted,
};

const footerLinkStyle: React.CSSProperties = {
  color: COLORS.muted,
  textDecoration: 'underline',
};

const footerFineStyle: React.CSSProperties = {
  margin: '10px 0 0',
  fontSize: '10px',
  lineHeight: '1.6',
  color: COLORS.muted,
};
