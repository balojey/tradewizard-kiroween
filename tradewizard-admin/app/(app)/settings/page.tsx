import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Card";
import { Page, PageHeader } from "@/components/ui/PageHeader";

/**
 * Settings placeholder.
 *
 * Deliberately not a form: every setting here needs a consumer in a product
 * service, and shipping switches that control nothing would be worse than
 * showing the plan. Tracked as Phase 4 in the architecture doc.
 */
export default function SettingsPage() {
  return (
    <Page>
      <PageHeader
        title="Settings"
        description="Runtime configuration. Not built yet — and deliberately not faked."
        meta={
          <>
            <span>Phase 4</span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>team access lives on Members</span>
          </>
        }
      />

      <Panel
        title="Why this page is empty"
        actions={<Badge tone="neutral">Phase 4</Badge>}
        className="max-w-[760px]"
      >
        <p className="text-[12px] leading-relaxed text-muted">
          Each setting below changes how a product service behaves, so it ships together with the
          code that reads it. A switch that stores a value nobody consumes would look like a control
          without being one.
        </p>

        <ul className="mt-3 flex flex-col text-[12px]">
          {[
            ["Pause analysis requests", "needs analysis-request"],
            ["Portfolio session cap override", "needs portfolio-activation"],
            ["AI provider / model overrides", "needs ai-provider"],
            ["Maintenance banner", "needs the product frontend"],
          ].map(([label, requirement]) => (
            <li
              key={label}
              className="flex items-center justify-between gap-3 border-b border-border-soft py-2 last:border-0"
            >
              <span className="text-muted">{label}</span>
              <span className="mono text-[10.5px] text-faint">{requirement}</span>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          Team access lives on Members, which is live.
        </p>
      </Panel>
    </Page>
  );
}
