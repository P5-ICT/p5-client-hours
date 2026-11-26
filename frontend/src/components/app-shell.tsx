"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { canApproveRole, homeFor, sectionsFor, useAuth } from "@/lib/auth";
import { ROLES, TABS, isCommonPath, isPublicPath, sectionFromPath } from "@/lib/nav";
import { useStore } from "@/lib/store";
import { Icon } from "./ui/icon";
import { Button, cn } from "./ui/primitives";

const SIDE_PAD = "pl-[max(16px,env(safe-area-inset-left,0px))] pr-[max(16px,env(safe-area-inset-right,0px))]";

function Logo() {
  return (
    <span className="grid flex-none place-items-center rounded-lg border border-line bg-white px-1.5 py-0.5">
      <Image src="/pillar5-logo.png" alt="Pillar 5, Above Average" width={319} height={236} priority className="block h-11 w-auto max-w-none" />
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, user } = useAuth();
  const { ready, data, loadError, refresh } = useStore();
  const isPublic = isPublicPath(pathname);

  // Where this person should be: the sign-in page when signed out, otherwise a section they may open.
  const target = (() => {
    if (status === "loading") return null;
    if (status === "out") return isPublic ? null : "/login";
    if (!user) return null;
    if (isPublic) return homeFor(user.appRole);
    if (isCommonPath(pathname)) return null;
    const section = sectionFromPath(pathname);
    if (!section || !sectionsFor(user.appRole).includes(section)) return homeFor(user.appRole);
    return null;
  })();

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (isPublic && status !== "in") {
    return (
      <>
        <header className="border-b-2 border-gold bg-surface">
          <div className={cn("mx-auto flex max-w-[1120px] items-center gap-2.5 py-2.5", SIDE_PAD)}>
            <Logo />
            <strong>Client Hours</strong>
          </div>
        </header>
        {children}
      </>
    );
  }

  if (status !== "in" || target) return <Loading text="Loading…" />;

  return (
    <>
      <Header />
      {ready ? (
        children
      ) : loadError ? (
        <main className={cn("mx-auto grid max-w-[1120px] justify-items-start gap-3 py-6", SIDE_PAD)} role="alert">
          <p>{loadError}</p>
          <Button variant="primary" onClick={() => void refresh()}>
            Try again
          </Button>
        </main>
      ) : (
        <Loading text="Loading hours…" />
      )}
      <Toast />
    </>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <main className={cn("mx-auto max-w-[1120px] py-6 text-muted", SIDE_PAD)} aria-busy="true">
      {text}
    </main>
  );
}

function Header() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  // Pages such as the account page belong to no section, so show the person's first one.
  const role = sectionFromPath(pathname) ?? sectionsFor(user!.appRole)[0]!;
  const { ready, data } = useStore();
  const appRole = user!.appRole;
  const sections = sectionsFor(appRole);
  // Only the people who can approve are shown the waiting count, and it leaves out their own entries.
  const pending =
    ready && canApproveRole(appRole) ? data.entries.filter((e) => e.status === "pending" && e.staffId !== user!.id).length : 0;

  return (
    <>
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-20 border-b-2 border-gold bg-surface print:hidden">
        <div className={cn("mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-4 gap-y-2.5 py-2.5", SIDE_PAD)}>
          <div className="mr-auto flex min-w-0 items-center gap-2.5">
            <Logo />
            <div className="min-w-0">
              <strong className="block">Client Hours</strong>
              <span className="block truncate text-[0.8125rem] text-muted">{ready ? data.settings.clientName : ""}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {sections.length > 1 && (
              <div role="group" aria-label="Section" className="inline-flex rounded-full bg-surface-2 p-[3px]">
                {ROLES.filter((r) => sections.includes(r.role)).map((r) => (
                  <Link
                    key={r.role}
                    href={TABS[r.role][0].href}
                    aria-current={role === r.role ? "page" : undefined}
                    className={cn(
                      "grid min-h-[38px] place-items-center rounded-full px-3.5 text-sm font-semibold no-underline transition-colors duration-200",
                      role === r.role ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
                    )}
                  >
                    {r.label}
                  </Link>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Link
                href="/account"
                title={`${user!.email}. Change your password`}
                aria-current={pathname === "/account" ? "page" : undefined}
                className="inline-flex min-h-11 max-w-[180px] items-center truncate text-[0.8125rem] text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                {user!.name}
              </Link>
              <Button variant="ghost" className="min-h-[38px] px-3 text-sm" onClick={logout}>
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </header>

      <nav
        aria-label="Main sections"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] md:static md:border-t-0 md:border-b md:p-0 print:hidden"
      >
        <ul className={cn("m-0 flex list-none p-0 md:mx-auto md:max-w-[1120px] md:gap-1 md:pl-[max(16px,env(safe-area-inset-left,0px))] md:pr-[max(16px,env(safe-area-inset-right,0px))]")}>
          {TABS[role].map((t) => {
            const current = pathname === t.href;
            return (
              <li key={t.href} className="flex-1 md:flex-none">
                <Link
                  href={t.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-[58px] w-full flex-col items-center justify-center gap-0.5 text-xs font-semibold no-underline transition-colors duration-200 md:min-h-12 md:flex-row md:gap-2 md:px-3.5 md:text-[0.9375rem]",
                    current
                      ? "text-accent md:after:absolute md:after:inset-x-2.5 md:after:-bottom-px md:after:h-[3px] md:after:rounded-t-[3px] md:after:bg-accent md:after:content-['']"
                      : "text-muted hover:text-ink",
                  )}
                >
                  <Icon name={t.icon} />
                  <span>{t.label}</span>
                  {t.href === "/manager/approvals" && pending > 0 && (
                    <span
                      aria-label={`${pending} waiting`}
                      className="absolute top-1.5 left-[calc(50%+6px)] grid h-5 min-w-5 place-items-center rounded-full bg-bad px-1.5 text-[0.6875rem] font-bold text-surface md:static"
                    >
                      {pending}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

function Toast() {
  const { toast } = useStore();
  return (
    <div
      role="status"
      aria-live="polite"
      hidden={!toast}
      className="fixed left-1/2 bottom-[calc(76px+env(safe-area-inset-bottom,0px))] z-40 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-lg bg-ink px-[18px] py-3 text-[0.9375rem] font-semibold text-surface shadow-card md:bottom-6 print:hidden"
    >
      {toast}
    </div>
  );
}

/** Wraps a page's content in the one-column layout used by every view. */
export function Page({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const first = useRef(true);
  // After a tab change, move focus to the content so keyboard and screen-reader users start at the top.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <main
      ref={ref}
      id="main"
      tabIndex={-1}
      className={cn("mx-auto grid max-w-[1120px] gap-5 pt-5 pb-[110px] md:pt-6 md:pb-12 print:max-w-none print:p-0", SIDE_PAD)}
    >
      {children}
    </main>
  );
}
