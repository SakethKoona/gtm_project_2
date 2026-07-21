"use client";

import { useCallback, useEffect, useState } from "react";
import { Users as UsersIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  email: string;
  name: string | null;
  role: "none" | "rep" | "admin";
  createdAt: string;
};

const ROLES: Row["role"][] = ["none", "rep", "admin"];

export default function UsersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/users").then((x) => x.json());
    setRows(r.users ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function setRole(userId: string, role: Row["role"]) {
    setSavingId(userId);
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    setSavingId(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "Could not update role.");
      return;
    }
    setRows((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
  }

  return (
    <main className="mx-auto max-w-4xl px-5 py-6">
      <div className="flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary">
          <UsersIcon className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Users</h1>
          <p className="text-xs text-muted-foreground">
            Assign roles. <b>none</b> = no access · <b>rep</b> = call console only ·
            <b> admin</b> = everything.
          </p>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No users yet.</td></tr>
            )}
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{u.name ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{u.email}</td>
                <td className="px-3 py-2">
                  <div className="inline-flex overflow-hidden rounded-md border border-border">
                    {ROLES.map((r) => (
                      <button
                        key={r}
                        disabled={savingId === u.id || u.role === r}
                        onClick={() => setRole(u.id, r)}
                        className={cn(
                          "px-2.5 py-1 text-xs font-medium transition-colors",
                          u.role === r
                            ? r === "admin"
                              ? "bg-primary text-primary-foreground"
                              : r === "rep"
                                ? "bg-emerald-600 text-white"
                                : "bg-muted text-muted-foreground"
                            : "bg-card text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
