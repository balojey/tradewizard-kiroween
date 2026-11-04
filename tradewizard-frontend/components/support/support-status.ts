import {
  Briefcase,
  CreditCard,
  Database,
  LineChart,
  LogIn,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import type { SupportTicketSummary, SupportTopic } from "@/lib/support-client";

type Status = SupportTicketSummary["status"];

/**
 * One vocabulary for the customer-facing support surfaces.
 *
 * The thread page, the account list and the form all name the same states; they
 * used to carry three copies of these maps, which is how "Waiting on you" drifted
 * from a bare "pending".
 */
export const SUPPORT_STATUS: Record<
  Status,
  {
    label: string;
    tone: "accent" | "warning" | "yes" | "muted";
    /** What the state means for the customer, in their words. */
    hint: string;
  }
> = {
  open: {
    label: "Open",
    tone: "accent",
    hint: "We have your request and will reply by email.",
  },
  pending: {
    label: "Waiting on you",
    tone: "warning",
    hint: "We replied. Add anything else below and we will pick it back up.",
  },
  resolved: {
    label: "Resolved",
    tone: "yes",
    hint: "We consider this resolved. Reply below if it is not.",
  },
  closed: {
    label: "Closed",
    tone: "muted",
    hint: "This request is closed. Start a new one if you need us.",
  },
};

export const SUPPORT_TOPICS: ReadonlyArray<{
  value: SupportTopic;
  label: string;
  hint: string;
  icon: LucideIcon;
}> = [
  {
    value: "analysis",
    label: "An analysis",
    hint: "A call, score or recommendation",
    icon: LineChart,
  },
  {
    value: "portfolio",
    label: "Portfolio Manager",
    hint: "A session, trade or balance",
    icon: Briefcase,
  },
  {
    value: "billing",
    label: "Billing & credits",
    hint: "Payment, plan or credit balance",
    icon: CreditCard,
  },
  {
    value: "login",
    label: "Signing in",
    hint: "Access, email links or codes",
    icon: LogIn,
  },
  {
    value: "data",
    label: "Wrong data",
    hint: "A missing or incorrect market",
    icon: Database,
  },
  {
    value: "other",
    label: "Something else",
    hint: "Anything that does not fit",
    icon: MessageSquare,
  },
];

export function topicMeta(topic: SupportTopic) {
  return SUPPORT_TOPICS.find((item) => item.value === topic) ?? SUPPORT_TOPICS[5];
}
