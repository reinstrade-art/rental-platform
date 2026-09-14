import "server-only";
import { redirect } from "next/navigation";
import type { Session } from "./auth";
import type { ModuleKey } from "./constants";

/**
 * Whether this session may use the given module. An ADMIN always can,
 * regardless of what's on file — permission sets narrow a MANAGER/VIEWER,
 * they never apply to the org's own admin seat. Everyone else defaults to
 * full access until an admin has deliberately set a permissions list.
 */
export function hasModuleAccess(s: Session, module: ModuleKey): boolean {
  if (s.role === "ADMIN") return true;
  if (s.permissions === null) return true;
  return s.permissions.includes(module);
}

/** Same one-liner every gated page already uses for tier features (`if (!hasFeature(...)) redirect(...)`) — the module-permission equivalent. */
export function requireModule(s: Session, module: ModuleKey) {
  if (!hasModuleAccess(s, module)) redirect("/home");
}
