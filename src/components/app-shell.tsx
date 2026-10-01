"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/client/api";
import { cn } from "./ui";

const TABS = [
  { href: "/", label: "Overview" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/apps", label: "Apps" },
  { href: "/accounts", label: "Accounts" },
  { href: "/business-centers", label: "Business Centers" },
  { href: "/reporting", label: "Reporting" },
  { href: "/rules", label: "Rules" },
  { href: "/actions-log", label: "Actions Log" },
  { href: "/settings/mcp", label: "MCP Status" },
];

/** Keeps BC / account / date filters when switching tabs, so the workflow stays fast. */
const CARRY = ["bcId", "advertiserId", "preset", "start", "end", "minCreativeSpend"];

function Nav() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const carry = new URLSearchParams();
  for (const k of CARRY) {
    const v = sp.get(k);
    if (v) carry.set(k, v);
  }
  const suffix = carry.toString() ? `?${carry}` : "";
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto">
      {TABS.map((t) => {
        const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={`${t.href}${t.href === "/settings/mcp" || t.href === "/actions-log" || t.href === "/rules" ? "" : suffix}`}
            className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-[13px]", active ? "border-fg font-medium" : "border-transparent text-muted hover:text-fg")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

function User() {
  const { data } = useApi<{ operator: string; authMode: string }>("/api/me");
  if (!data) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span>
        Signed in as <span className="font-medium text-fg">{data.operator}</span>
      </span>
      {data.authMode === "password" && (
        <button
          className="rounded p-1 hover:bg-surface-2"
          title="Sign out"
          onClick={async () => {
            await api("/api/auth/logout", { method: "POST" });
            window.location.href = "/login";
          }}
        >
          <LogOut className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between px-4 pt-3">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            TikTok Ads Control Center
          </Link>
          <User />
        </div>
        <div className="mx-auto max-w-[1680px] px-2">
          <Suspense>
            <Nav />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-4">
        <Suspense>{children}</Suspense>
      </main>
    </div>
  );
}
