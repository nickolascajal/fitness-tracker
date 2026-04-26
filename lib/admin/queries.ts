import { getServiceRoleSupabase } from "./supabaseServiceRole";
import { parseWorkoutEntryFromJson, type AdminWorkoutDisplayEntry } from "./parseWorkoutEntry";
import { unstable_noStore as noStore } from "next/cache";

export type AdminUserSummary = {
  userId: string;
  email: string | null;
  workoutCount: number;
  exerciseCount: number;
  presetCount: number;
};

export type AdminOverview = {
  totals: {
    activeUsersWithData: number;
    activeUsersTotal: number;
    workouts: number;
    exercises: number;
    presets: number;
    orphanedWorkouts: number;
    orphanedExercises: number;
    orphanedPresets: number;
  };
  users: AdminUserSummary[];
};

export type AdminOrphanCleanupResult = {
  orphanedUserIdsCount: number;
  deletedWorkouts: number;
  deletedExercises: number;
  deletedPresets: number;
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

function countByUser(rows: { user_id: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.user_id) increment(counts, row.user_id);
  }
  return counts;
}

function sumCountsForUsers(counts: Map<string, number>, userIds: Set<string>): number {
  let total = 0;
  for (const userId of userIds) {
    total += counts.get(userId) ?? 0;
  }
  return total;
}

function orphanedUserIdsFromCounts(
  activeUserIds: Set<string>,
  ...maps: Array<Map<string, number>>
): Set<string> {
  const orphaned = new Set<string>();
  for (const map of maps) {
    for (const userId of map.keys()) {
      if (!activeUserIds.has(userId)) {
        orphaned.add(userId);
      }
    }
  }
  return orphaned;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  noStore();
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

  const workoutCounts = countByUser(workoutRows);
  const exerciseCounts = countByUser(exerciseRows);
  const presetCounts = countByUser(presetRows);
  const emailById = await buildEmailMap();
  const activeUserIds = new Set<string>(emailById.keys());
  const orphanedUserIds = orphanedUserIdsFromCounts(activeUserIds, workoutCounts, exerciseCounts, presetCounts);

  const users: AdminUserSummary[] = Array.from(activeUserIds)
    .sort()
    .map((userId) => ({
      userId,
      email: emailById.get(userId) ?? null,
      workoutCount: workoutCounts.get(userId) ?? 0,
      exerciseCount: exerciseCounts.get(userId) ?? 0,
      presetCount: presetCounts.get(userId) ?? 0
    }))
    .filter((user) => user.workoutCount > 0 || user.exerciseCount > 0 || user.presetCount > 0);

  const activeUsersWithData = users.length;
  const activeWorkouts = sumCountsForUsers(workoutCounts, activeUserIds);
  const activeExercises = sumCountsForUsers(exerciseCounts, activeUserIds);
  const activePresets = sumCountsForUsers(presetCounts, activeUserIds);

  return {
    totals: {
      activeUsersWithData,
      activeUsersTotal: activeUserIds.size,
      workouts: activeWorkouts,
      exercises: activeExercises,
      presets: activePresets,
      orphanedWorkouts: sumCountsForUsers(workoutCounts, orphanedUserIds),
      orphanedExercises: sumCountsForUsers(exerciseCounts, orphanedUserIds),
      orphanedPresets: sumCountsForUsers(presetCounts, orphanedUserIds)
    },
    users
  };
}

export async function cleanupOrphanedRows(): Promise<AdminOrphanCleanupResult> {
  noStore();
  const admin = getServiceRoleSupabase();

  const [workoutsRes, exercisesRes, presetsRes] = await Promise.all([
    admin.from("workouts").select("user_id"),
    admin.from("exercises").select("user_id"),
    admin.from("presets").select("user_id")
  ]);

  if (workoutsRes.error || exercisesRes.error || presetsRes.error) {
    throw new Error("Failed to inspect orphaned rows before cleanup.");
  }

  const workoutCounts = countByUser((workoutsRes.data ?? []) as { user_id: string }[]);
  const exerciseCounts = countByUser((exercisesRes.data ?? []) as { user_id: string }[]);
  const presetCounts = countByUser((presetsRes.data ?? []) as { user_id: string }[]);
  const activeUserIds = new Set<string>((await buildEmailMap()).keys());
  const orphanedUserIds = Array.from(
    orphanedUserIdsFromCounts(activeUserIds, workoutCounts, exerciseCounts, presetCounts)
  );

  if (orphanedUserIds.length === 0) {
    return {
      orphanedUserIdsCount: 0,
      deletedWorkouts: 0,
      deletedExercises: 0,
      deletedPresets: 0
    };
  }

  const [deleteWorkoutsRes, deleteExercisesRes, deletePresetsRes] = await Promise.all([
    admin.from("workouts").delete().in("user_id", orphanedUserIds),
    admin.from("exercises").delete().in("user_id", orphanedUserIds),
    admin.from("presets").delete().in("user_id", orphanedUserIds)
  ]);

  if (deleteWorkoutsRes.error || deleteExercisesRes.error || deletePresetsRes.error) {
    throw new Error("Failed while deleting one or more orphaned row groups.");
  }

  const orphanedIdSet = new Set<string>(orphanedUserIds);
  return {
    orphanedUserIdsCount: orphanedUserIds.length,
    deletedWorkouts: sumCountsForUsers(workoutCounts, orphanedIdSet),
    deletedExercises: sumCountsForUsers(exerciseCounts, orphanedIdSet),
    deletedPresets: sumCountsForUsers(presetCounts, orphanedIdSet)
  };
}

export type AdminUserWorkoutRow = {
  id: string;
  createdAt: string | null;
  date: string | null;
  parsed: AdminWorkoutDisplayEntry | null;
  rawPreview: string | null;
};

export type AdminAssignablePreset = {
  id: string;
  name: string;
  exerciseCount: number;
};

export type AdminAssignPresetResult = {
  assignedCount: number;
  date: string;
};

export async function getUserWorkoutsForAdmin(userId: string): Promise<AdminUserWorkoutRow[]> {
  noStore();
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

type PresetExerciseConfig = {
  name: string;
  targetReps: number;
  setCount: number;
  increment: number;
  unit: "lbs" | "kg";
  trackRir: boolean;
  trackRpe: boolean;
};

type StoredUserExercise = {
  id: string;
  name: string;
  setCount: number;
  targetReps: number;
  increment: number;
  unit: "lbs" | "kg";
  trackRir: boolean;
  trackRpe: boolean;
};

function safePresetExercises(input: unknown): PresetExerciseConfig[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((exercise): exercise is PresetExerciseConfig => {
      if (!exercise || typeof exercise !== "object") return false;
      const row = exercise as Partial<PresetExerciseConfig>;
      return (
        typeof row.name === "string" &&
        typeof row.targetReps === "number" &&
        typeof row.setCount === "number" &&
        typeof row.increment === "number"
      );
    })
    .map((exercise) => ({
      ...exercise,
      unit: exercise.unit === "kg" ? "kg" : "lbs",
      trackRir: exercise.trackRir === true,
      trackRpe: exercise.trackRpe === true
    }));
}

function parseAssignablePresetRow(
  row: { id?: string | number; data?: unknown } | null | undefined
): { id: string; name: string; exercises: PresetExerciseConfig[] } | null {
  if (!row) return null;
  const payload = row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : null;
  if (!payload) return null;
  const idFromData = typeof payload.id === "string" ? payload.id : "";
  const idFromRow = row.id != null ? String(row.id) : "";
  const id = idFromData || idFromRow;
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const exercises = safePresetExercises(payload.exercises);
  if (!id || !name || exercises.length === 0) return null;
  return { id, name, exercises };
}

function parseStoredExerciseRow(
  row: { data?: unknown } | null | undefined
): StoredUserExercise | null {
  if (!row || !row.data || typeof row.data !== "object") return null;
  const payload = row.data as Record<string, unknown>;
  if (
    typeof payload.id !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.setCount !== "number" ||
    typeof payload.targetReps !== "number" ||
    typeof payload.increment !== "number"
  ) {
    return null;
  }
  return {
    id: payload.id,
    name: payload.name,
    setCount: payload.setCount,
    targetReps: payload.targetReps,
    increment: payload.increment,
    unit: payload.unit === "kg" ? "kg" : "lbs",
    trackRir: payload.trackRir === true,
    trackRpe: payload.trackRpe === true
  };
}

function sameConfig(exercise: StoredUserExercise, presetExercise: PresetExerciseConfig): boolean {
  return (
    exercise.name.trim().toLowerCase() === presetExercise.name.trim().toLowerCase() &&
    exercise.setCount === presetExercise.setCount &&
    exercise.targetReps === presetExercise.targetReps &&
    exercise.increment === presetExercise.increment &&
    exercise.unit === presetExercise.unit &&
    exercise.trackRir === presetExercise.trackRir &&
    exercise.trackRpe === presetExercise.trackRpe
  );
}

function buildDraftSets(setCount: number) {
  const count = Math.max(1, Math.floor(setCount));
  return Array.from({ length: count }, () => ({
    weight: "",
    reps: "",
    timeSeconds: 0,
    rir: "",
    tir: "",
    rpe: ""
  }));
}

export async function getAssignablePresetsForUser(userId: string): Promise<AdminAssignablePreset[]> {
  noStore();
  const admin = getServiceRoleSupabase();
  const { data, error } = await admin
    .from("presets")
    .select("id,data")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Admin assignable presets fetch failed:", error.message);
    return [];
  }

  const seen = new Set<string>();
  const presets: AdminAssignablePreset[] = [];
  for (const row of (data ?? []) as Array<{ id?: string | number; data?: unknown }>) {
    const parsed = parseAssignablePresetRow(row);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    presets.push({
      id: parsed.id,
      name: parsed.name,
      exerciseCount: parsed.exercises.length
    });
  }
  return presets;
}

export async function assignPresetDraftsToUserDate(
  userId: string,
  presetId: string,
  date: string
): Promise<AdminAssignPresetResult> {
  noStore();
  const admin = getServiceRoleSupabase();

  const { data: presetRows, error: presetError } = await admin
    .from("presets")
    .select("id,data")
    .eq("user_id", userId);
  if (presetError) {
    throw new Error(`Failed to load presets for assignment: ${presetError.message}`);
  }

  const parsedPresets = ((presetRows ?? []) as Array<{ id?: string | number; data?: unknown }>)
    .map((row) => parseAssignablePresetRow(row))
    .filter((preset): preset is { id: string; name: string; exercises: PresetExerciseConfig[] } => Boolean(preset));
  const selectedPreset = parsedPresets.find((preset) => preset.id === presetId);
  if (!selectedPreset) {
    throw new Error("Selected preset was not found for this user.");
  }

  const { data: exerciseRows, error: exercisesError } = await admin
    .from("exercises")
    .select("id,data")
    .eq("user_id", userId);
  if (exercisesError) {
    throw new Error(`Failed to load exercises for assignment: ${exercisesError.message}`);
  }

  const userExercises = ((exerciseRows ?? []) as Array<{ data?: unknown }>)
    .map((row) => parseStoredExerciseRow(row))
    .filter((exercise): exercise is StoredUserExercise => Boolean(exercise));

  const now = new Date().toISOString();
  const draftRows: Array<{ user_id: string; date: string; data: Record<string, unknown> }> = [];

  for (const presetExercise of selectedPreset.exercises) {
    let matched = userExercises.find((exercise) => sameConfig(exercise, presetExercise));
    if (!matched) {
      const newExercise: StoredUserExercise = {
        id: crypto.randomUUID(),
        name: presetExercise.name,
        setCount: presetExercise.setCount,
        targetReps: presetExercise.targetReps,
        increment: presetExercise.increment,
        unit: presetExercise.unit,
        trackRir: presetExercise.trackRir,
        trackRpe: presetExercise.trackRpe
      };
      const { error: insertExerciseError } = await admin.from("exercises").insert({
        user_id: userId,
        data: {
          ...newExercise,
          type: "weight",
          foundation: 0,
          isUserCreated: true
        }
      });
      if (insertExerciseError) {
        throw new Error(`Failed to create missing exercise config: ${insertExerciseError.message}`);
      }
      userExercises.push(newExercise);
      matched = newExercise;
    }

    draftRows.push({
      user_id: userId,
      date,
      data: {
        workoutId: crypto.randomUUID(),
        exerciseId: matched.id,
        exerciseName: matched.name,
        workoutDate: date,
        isDraft: true,
        sets: buildDraftSets(matched.setCount),
        sessionVolume: 0,
        sessionCps: null,
        progressionStage: "—",
        recommendation: "Added from preset — enter your sets to log this workout.",
        submittedAt: now
      }
    });
  }

  if (draftRows.length > 0) {
    const { error: insertWorkoutError } = await admin.from("workouts").insert(draftRows);
    if (insertWorkoutError) {
      throw new Error(`Failed to assign draft workouts: ${insertWorkoutError.message}`);
    }
  }

  return { assignedCount: draftRows.length, date };
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
