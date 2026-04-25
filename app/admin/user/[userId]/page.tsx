import Link from "next/link";
import { AdminUserWorkoutsClient } from "../../admin-user-workouts-client";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PageProps = {
  params: Promise<{ userId: string }>;
};

export default async function AdminUserDetailPage(props: PageProps) {
  const { userId } = await props.params;

  if (!UUID_RE.test(userId)) {
    return (
      <section className="space-y-4">
        <Link href="/admin" className="text-sm font-medium text-slate-700 underline underline-offset-2">
          ← Back to admin
        </Link>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Invalid user id in URL. Expected a UUID.
        </p>
      </section>
    );
  }

  return (
    <AdminUserWorkoutsClient userId={userId} expectedAdminEmail={process.env.ADMIN_EMAIL!.trim()} />
  );
}
