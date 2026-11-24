import type { IconName } from "@/components/ui/icon";
import type { Role } from "./types";

export interface Tab {
  href: string;
  label: string;
  icon: IconName;
}

export const ROLES: Array<{ role: Role; label: string }> = [
  { role: "staff", label: "My work" },
  { role: "manager", label: "Management" },
  { role: "client", label: "Client" },
];

export const TABS: Record<Role, Tab[]> = {
  staff: [
    { href: "/staff/track", label: "Track time", icon: "clock" },
    { href: "/staff/entries", label: "My entries", icon: "list" },
    { href: "/staff/overview", label: "Overview", icon: "chart" },
  ],
  manager: [
    { href: "/manager/overview", label: "Overview", icon: "chart" },
    { href: "/manager/approvals", label: "Approvals", icon: "inbox" },
    { href: "/manager/entries", label: "All entries", icon: "list" },
    { href: "/manager/reports", label: "Reports", icon: "report" },
    { href: "/manager/setup", label: "Team and settings", icon: "sliders" },
  ],
  client: [{ href: "/client/report", label: "Hours report", icon: "report" }],
};

/** Pages anyone can open without signing in. */
export const PUBLIC_PATHS = ["/login", "/set-password", "/forgot-password"];

export const isPublicPath = (pathname: string) => PUBLIC_PATHS.includes(pathname);

/** Signed-in pages that belong to no section, so every role may open them. */
export const COMMON_PATHS = ["/account"];

export const isCommonPath = (pathname: string) => COMMON_PATHS.includes(pathname);

/** Which section of the app a path belongs to, or null for pages outside the sections. */
export function sectionFromPath(pathname: string): Role | null {
  const seg = pathname.split("/")[1];
  return seg === "staff" || seg === "manager" || seg === "client" ? seg : null;
}

export function roleFromPath(pathname: string): Role {
  return sectionFromPath(pathname) ?? "staff";
}
