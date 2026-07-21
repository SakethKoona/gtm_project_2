import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth/guards";
import { AppShell } from "@/components/app-shell";

/** Guards every in-app page: must be signed in with an assigned role. */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, role } = await requireSignedIn();
  if (role === "none") redirect("/no-access");
  return (
    <AppShell
      role={role}
      userName={session.user.name ?? session.user.email ?? "User"}
    >
      {children}
    </AppShell>
  );
}
