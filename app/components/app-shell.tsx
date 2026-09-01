"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Wraps the authenticated app's sidebar nav + content area. Split out as a
 * client component purely so the sidebar can be an off-canvas drawer on
 * phone widths (a fixed 224px sidebar was eating ~40% of a phone screen and
 * squeezing every table header into an unreadable run-on) -- everything
 * else about the shell (org name, nav items, sign-out) still comes from the
 * server layout as props/children.
 */
export function AppShell({
  orgName,
  nav,
  logoutAction,
  children,
}: {
  orgName: string;
  nav: { href: string; label: string; attention?: boolean }[];
  logoutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Mobile-only top bar: the sidebar is off-canvas below md, so this is
          the only way to reach nav/org name on a phone. */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-silver bg-ink-photo px-4 text-lily md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex flex-col gap-1 rounded p-1.5 hover:bg-ink-soft"
        >
          <span className="block h-0.5 w-5 bg-lily" />
          <span className="block h-0.5 w-5 bg-lily" />
          <span className="block h-0.5 w-5 bg-lily" />
        </button>
        <span className="truncate border-l-2 border-gold pl-2 font-semibold tracking-tight">{orgName}</span>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-56 shrink-0 flex-col bg-ink-photo text-lily transition-transform duration-200 ease-in-out md:sticky md:top-0 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-1 shrink-0 bg-metal" />
        <div className="flex flex-1 flex-col overflow-y-auto px-4 py-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="border-l-2 border-gold pl-2 font-semibold tracking-tight">{orgName}</div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="text-lily/70 hover:text-gold md:hidden"
            >
              ✕
            </button>
          </div>
          <nav className="flex flex-col gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                // Bold + red is the one place this shell departs from the
                // three-color ink/silver/lily palette on purpose -- an alert
                // that needs attention shouldn't look like every other nav
                // item until someone happens to click into it.
                className={`rounded px-2 py-1.5 text-sm transition-colors hover:bg-ink-soft hover:text-gold ${
                  item.attention ? "font-bold text-red-400" : "text-lily/85"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <form action={logoutAction} className="mt-6">
            <button className="text-sm text-silver underline hover:text-gold">Sign out</button>
          </form>
        </div>
      </aside>

      {/* pt-14 clears the fixed mobile top bar; md: drops it since the
          sidebar is in normal flow again there. */}
      <div className="min-w-0 flex-1 pt-14 md:pt-0">{children}</div>
    </div>
  );
}
