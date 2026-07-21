import { requirePage } from "@/lib/auth/guards";

/** Admin-only subtree: lead ingestion, dialer dashboard, user management.
 *  Reps are redirected to the console; unassigned users to the pending page. */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePage(["admin"]);
  return <>{children}</>;
}
