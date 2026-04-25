import { getServiceRoleSupabase } from "./supabaseServiceRole";
import { parseWorkoutEntryFromJson, type AdminWorkoutDisplayEntry } from "./parseWorkoutEntry";

export type AdminUserSummary = {
  userId: string;
  email: string | null;
  workoutCount: number;
  exerciseCount: number;
  presetCount: number;
};

export type AdminOverview = {
  totals: {
    usersWithData: number;
    workouts: number;
    exercises: number;
    presets: number;
  };
  users: AdminUserSummary[];
};

function increment(map: Map<string, number>, userId: string) {
  map.set(userId, (map.get(userId) ?? 0) + 1);
}

async function buildEmailMap(): Promise<Map<string, string>> {
  const admin = getServiceRoleSupabase();
  const emailById = new Map<string, string>();
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("Admin listUsers failed:", error.message);
      break;
    }
    const users = data?.users ?? [];
    for (const u of users) {
      if (u.id && u.email) {
        emailById.set(u.id, u.email);
      }
    }
    if (users.length < perPage) break;
    page += 1;
    if (page > 50) break;
  }
  return emailById;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const admin = getServiceRoleSupabase();

  const [workoutsRes, exercisesRes, presetsRes] = await Promise.all([
    admin.from("workouts").select("user_id"),
    admin.from("exercises").select("user_id"),
    admin.from("presets").select("user_id")
  ]);

  if (workoutsRes.error) {
    console.error("Admin workouts fetch:", workoutsRes.error.message);
  }
  if (exercisesRes.error) {
    console.error("Admin exercises fetch:", exercisesRes.error.message);
  }
  if (presetsRes.error) {
    console.error("Admin presets fetch:", presetsRes.error.message);
  }

  const workoutRows = (workoutsRes.data ?? []) as { user_id: string }[];
  const exerciseRows = (exercisesRes.data ?? []) as { user_id: string }[];
  const presetRows = (presetsRes.data ?? []) as { user_id: string }[];

  const workoutCounts = new Map<string, number>();
  const exerciseCounts = new Map<string, number>();
  const presetCounts = new Map<string, number>();

  for (const row of workoutRows) {
    if (row.user_id) increment(workoutCounts, row.user_id);
  }
  for (const row of exerciseRows) {
    if (row.user_id) increment(exerciseCounts, row.user_id);
  }
  for (const row of presetRows) {
    if (row.user_id) increment(presetCounts, row.user_id);
  }

  const allUserIds = new Set<string>();
  for (const id of workoutCounts.keys()) allUserIds.add(id);
  for (const id of exerciseCounts.keys()) allUserIds.add(id);
  for (const id of presetCounts.keys()) allUserIds.add(id);

  const emailById = await buildEmailMap();

  const users: AdminUserSummary[] = Array.from(allUserIds)
    .sort()
    .map((userId) => ({
      userId,
      email: emailById.get(userId) ?? null,
      workoutCount: workoutCounts.get(userId) ?? 0,
      exerciseCount: exerciseCounts.get(userId) ?? 0,
      presetCount: presetCounts.get(userId) ?? 0
    }));

  const usersWithWorkoutRows = new Set(
    workoutRows.map((r) => r.user_id).filter((id): id is string => Boolean(id))
  ).size;

  return {
    totals: {
      usersWithData: usersWithWorkoutRows,
      workouts: workoutRows.length,
      exercises: exerciseRows.length,
      presets: presetRows.length
    },
    users
  };
}

export type AdminUserWorkoutRow = {
  id: string;
  createdAt: string | null;
  date: string | null;
  parsed: AdminWorkoutDisplayEntry | null;
  rawPreview: string | null;
};

export async function getUserWorkoutsForAdmin(userId: string): Promise<AdminUserWorkoutRow[]> {
  const admin = getServiceRoleSupabase();
  const { data, error } = await admin
    .from("workouts")
    .select("id, user_id, date, data, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Admin user workouts fetch:", error.message);
    return [];
  }

  const rows = (data ?? []) as Array<{
    id: string;
    date?: string | null;
    data?: unknown;
    created_at?: string | null;
  }>;

  return rows.map((row) => {
    let payload: unknown = row.data;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }
    const parsed = parseWorkoutEntryFromJson(payload, row.date ?? null);
    const rawPreview =
      parsed === null && payload != null
        ? typeof payload === "string"
          ? payload.slice(0, 200)
          : JSON.stringify(payload).slice(0, 200)
        : null;

    return {
      id: String(row.id),
      createdAt: row.created_at ?? null,
      date: row.date ?? null,
      parsed,
      rawPreview
    };
  });
}

export function groupWorkoutsByDate(rows: AdminUserWorkoutRow[]): Map<string, AdminUserWorkoutRow[]> {
  const map = new Map<string, AdminUserWorkoutRow[]>();
  for (const row of rows) {
    const dateKey =
      row.parsed?.workoutDate?.trim() ||
      (typeof row.date === "string" && row.date.trim() !== "" ? row.date : "") ||
      "unknown";
    const list = map.get(dateKey) ?? [];
    list.push(row);
    map.set(dateKey, list);
  }
  const sortedKeys = Array.from(map.keys()).sort();
  const ordered = new Map<string, AdminUserWorkoutRow[]>();
  for (const k of sortedKeys) {
    ordered.set(k, map.get(k)!);
  }
  return ordered;
}
