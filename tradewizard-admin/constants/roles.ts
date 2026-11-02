/**
 * Role model, mirrored from infra/services/shared/admin-auth.ts.
 *
 * The backend is the only authority; these values exist so the UI can hide
 * actions a caller cannot perform. Never treat this as enforcement.
 */

export type AdminRole = "analyst" | "support" | "admin" | "owner";

export const ROLE_RANK: Record<AdminRole, number> = {
  analyst: 10,
  support: 20,
  admin: 30,
  owner: 40,
};

export const ROLE_LABEL: Record<AdminRole, string> = {
  analyst: "Analyst",
  support: "Support",
  admin: "Admin",
  owner: "Owner",
};

export const ROLE_DESCRIPTION: Record<AdminRole, string> = {
  analyst: "Read-only: metrics, analyses, agent performance",
  support: "Read all; grant credits, resend email, notes, pause sessions",
  admin: "All mutations except settings and role changes",
  owner: "Everything, including settings and role changes",
};

export function hasRole(current: AdminRole, minimum: AdminRole): boolean {
  return ROLE_RANK[current] >= ROLE_RANK[minimum];
}

export interface AdminIdentity {
  sub: string;
  email: string;
  role: AdminRole;
  roleRank: number;
  mfa: boolean;
  userId: string | null;
  linked: boolean;
}
