"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Headphones, LayoutDashboard, Upload, Users, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/auth/users";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Headphones;
  roles: UserRole[];
};

const NAV: NavItem[] = [
  { href: "/console", label: "Call Console", icon: Headphones, roles: ["rep", "admin"] },
  { href: "/dashboard", label: "Dialer Dashboard", icon: LayoutDashboard, roles: ["admin"] },
  { href: "/", label: "Leads / Ingestion", icon: Upload, roles: ["admin"] },
  { href: "/users", label: "Users", icon: Users, roles: ["admin"] },
];

export function AppShell({
  children,
  role,
  userName,
}: {
  children: React.ReactNode;
  role: UserRole;
  userName: string;
}) {
  const path = usePathname();
  const items = NAV.filter((n) => n.roles.includes(role));

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar p-3">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary/15 text-primary">
            <Headphones className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold">Sales Platform</span>
        </div>

        <nav className="mt-2 flex flex-col gap-0.5">
          {items.map((n) => {
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

        <div className="mt-auto border-t border-border pt-3">
          <div className="px-2.5 pb-2">
            <div className="truncate text-sm font-medium">{userName}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {role}
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
