import { AdminExerciseAnalyticsClient } from "../admin-exercise-analytics-client";

export default function AdminExerciseAnalyticsPage() {
  return <AdminExerciseAnalyticsClient expectedAdminEmail={process.env.ADMIN_EMAIL!.trim()} />;
}
