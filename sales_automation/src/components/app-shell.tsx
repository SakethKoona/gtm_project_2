"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Headphones, LayoutDashboard, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/console", label: "Call Console", icon: Headphones, section: "Rep" },
  { href: "/dashboard", label: "Dialer Dashboard", icon: LayoutDashboard, section: "Admin" },
  { href: "/", label: "Leads / Ingestion", icon: Upload, section: "Admin" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-sidebar p-3">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary/15 text-primary">
            <Headphones className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold">Sales Platform</span>
        </div>
        {["Rep", "Admin"].map((section) => (
          <div key={section} className="mt-2">
            <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {section}
            </div>
            <nav className="flex flex-col gap-0.5">
              {NAV.filter((n) => n.section === section).map((n) => {
                const active = path === n.href;
                const Icon = n.icon;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                      active
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {n.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
