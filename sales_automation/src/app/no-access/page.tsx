import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getLiveRole } from "@/lib/auth/users";
import { homeFor } from "@/lib/auth/guards";
import { Button } from "@/components/ui/button";
import { Clock } from "lucide-react";

/** Landing for signed-in users whose role is still "none" (awaiting access). */
export default async function NoAccessPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = (await getLiveRole(session.user.id)) ?? "none";
  if (role !== "none") redirect(homeFor(role));

  return (
    <div className="mx-auto grid min-h-screen max-w-md place-items-center px-6 text-center">
      <div className="space-y-4">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-100 text-amber-700">
          <Clock className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold">You haven’t been given access yet</h1>
        <p className="text-sm text-muted-foreground">
          Your account (<span className="font-medium">{session.user.email}</span>) is
          created but an admin hasn’t assigned you a role. Once they make you a rep or
          an admin, you’ll be able to sign in and get to work.
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <Button type="submit" variant="outline">Sign out</Button>
        </form>
      </div>
    </div>
  );
}
