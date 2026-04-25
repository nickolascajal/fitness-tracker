import { AdminDashboardClient } from "./admin-dashboard-client";

export default function AdminDashboardPage() {
  return <AdminDashboardClient expectedAdminEmail={process.env.ADMIN_EMAIL!.trim()} />;
}
