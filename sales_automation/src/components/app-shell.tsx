"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  GitBranch,
  Headphones,
  LayoutDashboard,
  Upload,
  Users,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConsoleDock } from "@/components/console-dock";
import type { UserRole } from "@/lib/auth/users";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Headphones;
  section: "Rep" | "Admin";
  roles: UserRole[];
};

const NAV: NavItem[] = [
  { href: "/console", label: "Call Console", icon: Headphones, section: "Rep", roles: ["rep", "admin"] },
  { href: "/pipeline", label: "Pipeline", icon: GitBranch, section: "Rep", roles: ["rep", "admin"] },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, section: "Admin", roles: ["admin"] },
  { href: "/", label: "Leads", icon: Upload, section: "Admin", roles: ["admin"] },
  { href: "/users", label: "Users", icon: Users, section: "Admin", roles: ["admin"] },
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
  const visible = NAV.filter((n) => n.roles.includes(role));
  const sections = (["Rep", "Admin"] as const).filter((s) =>
    visible.some((n) => n.section === s),
  );

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col bg-primary text-primary-foreground">
        <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-5">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/10">
            <Headphones className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-lg font-bold leading-tight tracking-tight">
              Transpira
            </h1>
            <p className="truncate text-[11px] text-white/50">GTM · Sales</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col px-2 py-3">
          {sections.map((section) => (
            <div key={section}>
              <div className="px-3 pb-1 pt-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-white/40">
                {section}
              </div>
              <div className="flex flex-col gap-0.5">
                {visible
                  .filter((n) => n.section === section)
                  .map((n) => {
                    const active = path === n.href;
                    const Icon = n.icon;
                    return (
                      <Link
                        key={n.href}
                        href={n.href}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm outline-none transition-[transform,color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 active:scale-[0.98]",
                          active
                            ? "bg-white/15 font-medium text-white"
                            : "text-white/70 hover:bg-white/10 hover:text-white",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {n.label}
                      </Link>
                    );
                  })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-2 py-3">
          <div className="px-3 pb-2">
            <div className="truncate text-sm font-medium text-white">{userName}</div>
            <div className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-white/40">
              {role}
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/70 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>

      {/* Admins get the always-available floating Call Console (no tab switch). */}
      {role === "admin" && <ConsoleDock />}
    </div>
  );
}
