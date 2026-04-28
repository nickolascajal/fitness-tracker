import { getServiceRoleSupabase } from "./supabaseServiceRole";
import { parseWorkoutEntryFromJson, type AdminWorkoutDisplayEntry } from "./parseWorkoutEntry";
import { unstable_noStore as noStore } from "next/cache";
import { calculateCPSWithOptions } from "@/lib/calculateCPS";
import { calculateProgressionStage } from "@/lib/calculateProgressionStage";
import { generateRecommendation } from "@/lib/generateRecommendation";
import { canSubmitWorkoutInputs, parseTrimmedNumberString } from "@/lib/workoutInputValidation";

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
  exercises: PresetExerciseConfig[];
};

export type AdminAssignPresetResult = {
  assignedCount: number;
  date: string;
};

export type AdminCreatePresetExercise = {
  id?: string;
  name: string;
  type?: "weight" | "bodyweight" | "time";
  targetReps: number;
  setCount: number;
  increment: number;
  unit: "lbs" | "kg";
  trackRir: boolean;
  trackRpe: boolean;
};

export type AdminCreatePresetInput = {
  name: string;
  exercises: AdminCreatePresetExercise[];
};

export type AdminCreatePresetResult = {
  presetId: string;
};

export type AdminHistoricalSetInput = {
  weight: string;
  reps: string;
  timeSeconds: string;
  rir?: string;
  tir?: string;
  rpe?: string;
};

export type AdminHistoricalPresetExerciseInput = {
  presetExerciseId: string;
  sets: AdminHistoricalSetInput[];
};

export type AdminAddHistoricalPresetInput = {
  presetId: string;
  date: string;
  exercises: AdminHistoricalPresetExerciseInput[];
};

export type AdminAddHistoricalResult = {
  addedCount: number;
  date: string;
};

export type AdminUserExerciseConfig = {
  id: string;
  name: string;
  type: "weight" | "bodyweight" | "time";
  targetReps: number;
  setCount: number;
  increment: number;
  unit: "lbs" | "kg";
  trackRir: boolean;
  trackRpe: boolean;
  foundation: number;
};

export type AdminSingleWorkoutSetInput = {
  weight: string;
  reps: string;
  timeSeconds: string;
  rir?: string;
  tir?: string;
  rpe?: string;
};

export type AdminSingleWorkoutInput = {
  date: string;
  mode: "planned" | "historical";
  exerciseId?: string;
  exerciseConfig?: {
    name: string;
    type: "weight" | "bodyweight" | "time";
    targetReps: number;
    setCount: number;
    increment: number;
    unit: "lbs" | "kg";
    trackRir: boolean;
    trackRpe: boolean;
  };
  prefill?: AdminDraftPrefillInput;
  sets?: AdminSingleWorkoutSetInput[];
};

export type AdminSingleWorkoutResult = {
  addedCount: number;
  date: string;
};

export type AdminUpdateWorkoutInput = {
  date: string;
  mode: "planned" | "historical";
  prefill?: AdminDraftPrefillInput;
  sets?: AdminSingleWorkoutSetInput[];
};

export type AdminUpdateWorkoutResult = {
  updated: boolean;
};

export type AdminDeleteWorkoutResult = {
  deleted: boolean;
};

export type AdminDraftPrefillInput = {
  weight?: string;
  reps?: string;
  timeSeconds?: string;
  rir?: string;
  tir?: string;
  rpe?: string;
};

export type AdminDraftPrefillByExercise = {
  presetExerciseId: string;
  prefill?: AdminDraftPrefillInput;
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

  return rows
    .map((row) => {
    let payload: unknown = row.data;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }
    if (parseRestDayMarkerPayload(payload)) {
      return null;
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
  })
    .filter((row): row is AdminUserWorkoutRow => Boolean(row));
}

type PresetExerciseConfig = {
  id: string;
  name: string;
  type: "weight" | "bodyweight" | "time";
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
  type: "weight" | "bodyweight" | "time";
  foundation: number;
  trackRir: boolean;
  trackRpe: boolean;
};

type RestDayMarkerPayload = {
  calendarMarker: "rest_day";
  date: string;
  createdAt: string;
};

const REST_DAY_MARKER = "rest_day";

function safePresetExercises(input: unknown): PresetExerciseConfig[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((exercise, index): PresetExerciseConfig | null => {
      if (!exercise || typeof exercise !== "object") return null;
      const row = exercise as Partial<PresetExerciseConfig>;
      if (
        typeof row.name !== "string" ||
        typeof row.targetReps !== "number" ||
        typeof row.setCount !== "number" ||
        typeof row.increment !== "number"
      ) {
        return null;
      }
      return {
        id:
          typeof row.id === "string" && row.id.trim() !== ""
            ? row.id
            : `legacy-${index}-${row.name.trim().toLowerCase()}`,
        name: row.name,
        type: row.type === "time" || row.type === "bodyweight" ? row.type : "weight",
        targetReps: row.targetReps,
        setCount: row.setCount,
        increment: row.increment,
        unit: row.unit === "kg" ? "kg" : "lbs",
        trackRir: row.trackRir === true,
        trackRpe: row.trackRpe === true
      };
    })
    .filter((exercise): exercise is PresetExerciseConfig => Boolean(exercise));
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
    type: payload.type === "time" || payload.type === "bodyweight" ? payload.type : "weight",
    foundation: Number.isFinite(payload.foundation) ? Number(payload.foundation) : 0,
    trackRir: payload.trackRir === true,
    trackRpe: payload.trackRpe === true
  };
}

function parseRestDayMarkerPayload(payload: unknown): RestDayMarkerPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (row.calendarMarker !== REST_DAY_MARKER) return null;
  if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return null;
  return {
    calendarMarker: REST_DAY_MARKER,
    date: row.date,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString()
  };
}

function computeSessionVolumeFromSetInputs(sets: AdminHistoricalSetInput[]): number {
  return sets.reduce((acc, set) => {
    const weight = Number(set.weight);
    const reps = Number(set.reps);
    if (!Number.isFinite(weight) || !Number.isFinite(reps)) return acc;
    return acc + weight * reps;
  }, 0);
}

function buildEffectiveCpsSets(
  sets: Array<{ weight: string; reps: string }>,
  foundation: number
): Array<{ weight: string | number; reps: string }> {
  return sets.map((set) => {
    const enteredWeight = Number(set.weight);
    if (enteredWeight === 0 && foundation > 0) {
      return { ...set, weight: foundation };
    }
    return set;
  });
}

function normalizeHistoricalSetInput(
  set: AdminHistoricalSetInput,
  exerciseType: "weight" | "bodyweight" | "time",
  trackRir: boolean,
  trackRpe: boolean
) {
  return {
    weight: set.weight,
    reps: set.reps,
    timeSeconds: parseTrimmedNumberString(set.timeSeconds),
    rir: trackRir && exerciseType !== "time" ? (set.rir ?? "") : "",
    tir: trackRir && exerciseType === "time" ? (set.tir ?? "") : "",
    rpe: trackRpe ? (set.rpe ?? "") : ""
  };
}

function sameConfig(exercise: StoredUserExercise, presetExercise: PresetExerciseConfig): boolean {
  return (
    exercise.name.trim().toLowerCase() === presetExercise.name.trim().toLowerCase() &&
    exercise.type === presetExercise.type &&
    exercise.setCount === presetExercise.setCount &&
    exercise.targetReps === presetExercise.targetReps &&
    exercise.increment === presetExercise.increment &&
    exercise.unit === presetExercise.unit &&
    exercise.trackRir === presetExercise.trackRir &&
    exercise.trackRpe === presetExercise.trackRpe
  );
}

function buildDraftSetsWithPrefill(setCount: number, prefill?: AdminDraftPrefillInput) {
  const count = Math.max(1, Math.floor(setCount));
  const normalizedWeight = (prefill?.weight ?? "").trim();
  const normalizedReps = (prefill?.reps ?? "").trim();
  const normalizedRir = (prefill?.rir ?? "").trim();
  const normalizedTir = (prefill?.tir ?? "").trim();
  const normalizedRpe = (prefill?.rpe ?? "").trim();
  const rawTime = Number(prefill?.timeSeconds ?? "");
  const normalizedTime = Number.isFinite(rawTime) && rawTime > 0 ? rawTime : 0;
  return Array.from({ length: count }, () => ({
    weight: normalizedWeight,
    reps: normalizedReps,
    timeSeconds: normalizedTime,
    rir: normalizedRir,
    tir: normalizedTir,
    rpe: normalizedRpe
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
      exerciseCount: parsed.exercises.length,
      exercises: parsed.exercises
    });
  }
  return presets;
}

export async function getRestDatesForUser(userId: string): Promise<string[]> {
  noStore();
  const admin = getServiceRoleSupabase();
  const { data, error } = await admin.from("workouts").select("date,data").eq("user_id", userId);
  if (error) {
    throw new Error(`Failed to load rest dates: ${error.message}`);
  }
  const out = new Set<string>();
  for (const row of (data ?? []) as Array<{ date?: string | null; data?: unknown }>) {
    let payload = row.data;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }
    const marker = parseRestDayMarkerPayload(payload);
    if (!marker) continue;
    out.add(marker.date || (typeof row.date === "string" ? row.date : ""));
  }
  return Array.from(out).filter(Boolean).sort();
}

export async function setRestDayForUser(userId: string, date: string, isRest: boolean): Promise<void> {
  noStore();
  const admin = getServiceRoleSupabase();
  const { data, error } = await admin
    .from("workouts")
    .select("id,data")
    .eq("user_id", userId)
    .eq("date", date);
  if (error) {
    throw new Error(`Failed to update rest day: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ id?: string | number; data?: unknown }>;
  const markerRowIds: string[] = [];
  let hasRealWorkouts = false;
  for (const row of rows) {
    let payload = row.data;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }
    if (parseRestDayMarkerPayload(payload)) {
      if (row.id != null) markerRowIds.push(String(row.id));
      continue;
    }
    hasRealWorkouts = true;
  }

  if (isRest) {
    if (hasRealWorkouts) {
      throw new Error("Cannot mark rest day because workouts already exist on that date.");
    }
    if (markerRowIds.length > 0) {
      return;
    }
    const payload: RestDayMarkerPayload = {
      calendarMarker: REST_DAY_MARKER,
      date,
      createdAt: new Date().toISOString()
    };
    const { error: insertError } = await admin.from("workouts").insert({
      user_id: userId,
      date,
      data: payload
    });
    if (insertError) {
      throw new Error(`Failed to mark rest day: ${insertError.message}`);
    }
    return;
  }

  if (markerRowIds.length === 0) return;
  const { error: deleteError } = await admin.from("workouts").delete().in("id", markerRowIds).eq("user_id", userId);
  if (deleteError) {
    throw new Error(`Failed to clear rest day: ${deleteError.message}`);
  }
}

export async function assignPresetDraftsToUserDate(
  userId: string,
  presetId: string,
  date: string,
  prefilledByExercise: AdminDraftPrefillByExercise[] = []
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
  const { data: workoutDateRows, error: workoutDateRowsError } = await admin
    .from("workouts")
    .select("data")
    .eq("user_id", userId)
    .eq("date", date);
  if (workoutDateRowsError) {
    throw new Error(`Failed to verify date availability: ${workoutDateRowsError.message}`);
  }
  const isRestDay = ((workoutDateRows ?? []) as Array<{ data?: unknown }>).some((row) => {
    let payload = row.data;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }
    return parseRestDayMarkerPayload(payload) !== null;
  });
  if (isRestDay) {
    throw new Error("That date is marked as a rest day. Clear rest day first.");
  }
  const prefillMap = new Map(prefilledByExercise.map((item) => [item.presetExerciseId, item.prefill]));

  const { data: workoutDateRows2, error: workoutDateRowsError2 } = await admin
    .from("workouts")
    .select("id,data")
    .eq("user_id", userId)
    .eq("date", date);
  if (workoutDateRowsError2) {
    throw new Error(`Failed to verify date availability: ${workoutDateRowsError2.message}`);
  }
  const isRestDay2 = ((workoutDateRows2 ?? []) as Array<{ data?: unknown }>).some((row) => {
    let payload = row.data;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }
    return parseRestDayMarkerPayload(payload) !== null;
  });
  if (isRestDay2) {
    throw new Error("That date is marked as a rest day. Clear rest day first.");
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
        type: presetExercise.type,
        foundation: 0,
        trackRir: presetExercise.trackRir,
        trackRpe: presetExercise.trackRpe
      };
      const { error: insertExerciseError } = await admin.from("exercises").insert({
        user_id: userId,
        data: {
          ...newExercise,
          type: presetExercise.type,
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
        sets: buildDraftSetsWithPrefill(matched.setCount, prefillMap.get(presetExercise.id)),
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

export async function createPresetForUser(
  userId: string,
  input: AdminCreatePresetInput
): Promise<AdminCreatePresetResult> {
  noStore();
  const admin = getServiceRoleSupabase();

  const presetName = input.name.trim();
  if (!presetName) {
    throw new Error("Preset name is required.");
  }
  if (!Array.isArray(input.exercises) || input.exercises.length === 0) {
    throw new Error("At least one exercise is required.");
  }

  const sanitizedExercises = input.exercises
    .map((exercise) => ({
      id: typeof exercise.id === "string" && exercise.id.trim() !== "" ? exercise.id : crypto.randomUUID(),
      name: exercise.name.trim(),
      type: exercise.type === "time" || exercise.type === "bodyweight" ? exercise.type : "weight",
      targetReps: Number(exercise.targetReps),
      setCount: Number(exercise.setCount),
      increment: Number(exercise.increment),
      unit: exercise.unit === "kg" ? "kg" : "lbs",
      trackRir: exercise.trackRir === true,
      trackRpe: exercise.trackRpe === true
    }))
    .filter(
      (exercise) =>
        exercise.id !== "" &&
        exercise.name !== "" &&
        Number.isFinite(exercise.targetReps) &&
        Number.isFinite(exercise.setCount) &&
        Number.isFinite(exercise.increment) &&
        exercise.targetReps > 0 &&
        exercise.setCount > 0 &&
        exercise.increment >= 0
    );

  if (sanitizedExercises.length === 0) {
    throw new Error("At least one valid exercise is required.");
  }

  const presetId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const payload = {
    id: presetId,
    name: presetName,
    exercises: sanitizedExercises,
    createdAt
  };

  const { error } = await admin.from("presets").insert({
    user_id: userId,
    data: payload
  });
  if (error) {
    throw new Error(`Failed to create preset for this user: ${error.message}`);
  }

  return { presetId };
}

export async function addHistoricalPresetWorkoutsToUserDate(
  userId: string,
  input: AdminAddHistoricalPresetInput
): Promise<AdminAddHistoricalResult> {
  noStore();
  const admin = getServiceRoleSupabase();
  const presetId = input.presetId.trim();
  const date = input.date.trim();
  if (!presetId) {
    throw new Error("Preset is required.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date format.");
  }
  if (!Array.isArray(input.exercises) || input.exercises.length === 0) {
    throw new Error("Completed set data is required.");
  }

  const { data: presetRows, error: presetError } = await admin
    .from("presets")
    .select("id,data")
    .eq("user_id", userId);
  if (presetError) {
    throw new Error(`Failed to load presets for import: ${presetError.message}`);
  }
  const parsedPresets = ((presetRows ?? []) as Array<{ id?: string | number; data?: unknown }>)
    .map((row) => parseAssignablePresetRow(row))
    .filter((preset): preset is { id: string; name: string; exercises: PresetExerciseConfig[] } => Boolean(preset));
  const selectedPreset = parsedPresets.find((preset) => preset.id === presetId);
  if (!selectedPreset) {
    throw new Error("Selected preset was not found for this user.");
  }

  const completedByPresetExerciseId = new Map(input.exercises.map((exercise) => [exercise.presetExerciseId, exercise]));
  const { data: exerciseRows, error: exercisesError } = await admin
    .from("exercises")
    .select("id,data")
    .eq("user_id", userId);
  if (exercisesError) {
    throw new Error(`Failed to load exercises for import: ${exercisesError.message}`);
  }
  const userExercises = ((exerciseRows ?? []) as Array<{ data?: unknown }>)
    .map((row) => parseStoredExerciseRow(row))
    .filter((exercise): exercise is StoredUserExercise => Boolean(exercise));

  const now = new Date().toISOString();
  const completedRows: Array<{ user_id: string; date: string; data: Record<string, unknown> }> = [];
  for (const presetExercise of selectedPreset.exercises) {
    const completed = completedByPresetExerciseId.get(presetExercise.id);
    if (!completed || !Array.isArray(completed.sets) || completed.sets.length === 0) {
      throw new Error(`Completed sets are required for ${presetExercise.name}.`);
    }
    let matched = userExercises.find((exercise) => sameConfig(exercise, presetExercise));
    if (!matched) {
      const newExercise: StoredUserExercise = {
        id: crypto.randomUUID(),
        name: presetExercise.name,
        setCount: presetExercise.setCount,
        targetReps: presetExercise.targetReps,
        increment: presetExercise.increment,
        unit: presetExercise.unit,
        type: presetExercise.type,
        foundation: 0,
        trackRir: presetExercise.trackRir,
        trackRpe: presetExercise.trackRpe
      };
      const { error: insertExerciseError } = await admin.from("exercises").insert({
        user_id: userId,
        data: {
          ...newExercise,
          type: presetExercise.type,
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

    if (!canSubmitWorkoutInputs(completed.sets, presetExercise.type, matched.foundation)) {
      throw new Error(`Complete set 1 and fill every remaining required field for ${presetExercise.name} (use 0 where needed).`);
    }

    const performanceSets = completed.sets.map((set) => ({ weight: set.weight, reps: set.reps }));
    const stage = calculateProgressionStage(performanceSets, matched.targetReps, matched.setCount);
    const recommendation = generateRecommendation(
      performanceSets,
      stage,
      matched.targetReps,
      matched.increment
    );
    const effectiveCpsSets = buildEffectiveCpsSets(performanceSets, matched.foundation);
    const cpsInputSets =
      presetExercise.type === "time"
        ? completed.sets.map((set) => ({
            weight: set.weight,
            reps: set.reps,
            timeSeconds: Number(set.timeSeconds ?? "")
          }))
        : effectiveCpsSets.map((set) => ({ ...set }));
    const sessionCps = calculateCPSWithOptions(cpsInputSets, matched.targetReps, {
      exerciseType: presetExercise.type,
      targetTimeSeconds: matched.targetReps,
      foundation: matched.foundation
    });
    const setsSnapshotForStorage = completed.sets.map((set) =>
      normalizeHistoricalSetInput(set, presetExercise.type, matched.trackRir, matched.trackRpe)
    );
    completedRows.push({
      user_id: userId,
      date,
      data: {
        workoutId: crypto.randomUUID(),
        exerciseId: matched.id,
        exerciseName: matched.name,
        workoutDate: date,
        isDraft: false,
        sets: setsSnapshotForStorage,
        sessionVolume: computeSessionVolumeFromSetInputs(completed.sets),
        sessionCps,
        progressionStage: stage ?? "—",
        recommendation,
        submittedAt: now
      }
    });
  }

  if (completedRows.length > 0) {
    const { error: insertWorkoutError } = await admin.from("workouts").insert(completedRows);
    if (insertWorkoutError) {
      throw new Error(`Failed to insert historical workouts: ${insertWorkoutError.message}`);
    }
  }

  return { addedCount: completedRows.length, date };
}

export async function getUserExerciseConfigsForAdmin(userId: string): Promise<AdminUserExerciseConfig[]> {
  noStore();
  const admin = getServiceRoleSupabase();
  const { data, error } = await admin.from("exercises").select("data").eq("user_id", userId);
  if (error) {
    throw new Error(`Failed to load exercises for user: ${error.message}`);
  }
  return ((data ?? []) as Array<{ data?: unknown }>)
    .map((row) => parseStoredExerciseRow(row))
    .filter((row): row is StoredUserExercise => Boolean(row))
    .map((row) => ({ ...row }));
}

async function resolveExerciseForSingleWorkout(
  userId: string,
  admin: ReturnType<typeof getServiceRoleSupabase>,
  input: AdminSingleWorkoutInput
): Promise<StoredUserExercise> {
  const { data: exerciseRows, error: exercisesError } = await admin
    .from("exercises")
    .select("id,data")
    .eq("user_id", userId);
  if (exercisesError) {
    throw new Error(`Failed to load exercises: ${exercisesError.message}`);
  }
  const userExercises = ((exerciseRows ?? []) as Array<{ data?: unknown }>)
    .map((row) => parseStoredExerciseRow(row))
    .filter((exercise): exercise is StoredUserExercise => Boolean(exercise));

  if (input.exerciseId) {
    const existing = userExercises.find((exercise) => exercise.id === input.exerciseId);
    if (!existing) {
      throw new Error("Selected exercise config was not found for this user.");
    }
    return existing;
  }

  const cfg = input.exerciseConfig;
  if (!cfg) {
    throw new Error("Provide an exercise config or select an existing exercise.");
  }
  const trimmedName = cfg.name.trim();
  if (!trimmedName) {
    throw new Error("Exercise name is required.");
  }
  const targetReps = Number(cfg.targetReps);
  const setCount = Number(cfg.setCount);
  const increment = Number(cfg.increment);
  if (!Number.isFinite(targetReps) || !Number.isFinite(setCount) || !Number.isFinite(increment)) {
    throw new Error("Exercise config contains invalid numbers.");
  }
  if (targetReps <= 0 || setCount <= 0 || increment < 0) {
    throw new Error("Exercise target/set/increment values are out of range.");
  }
  const created: StoredUserExercise = {
    id: crypto.randomUUID(),
    name: trimmedName,
    type: cfg.type,
    targetReps,
    setCount,
    increment,
    unit: cfg.unit === "kg" ? "kg" : "lbs",
    trackRir: cfg.trackRir === true,
    trackRpe: cfg.trackRpe === true,
    foundation: 0
  };
  const { error: insertExerciseError } = await admin.from("exercises").insert({
    user_id: userId,
    data: {
      ...created,
      isUserCreated: true
    }
  });
  if (insertExerciseError) {
    throw new Error(`Failed to create exercise config: ${insertExerciseError.message}`);
  }
  return created;
}

async function assertNotRestDay(
  userId: string,
  date: string,
  admin: ReturnType<typeof getServiceRoleSupabase>
): Promise<void> {
  const { data: rows, error } = await admin.from("workouts").select("data").eq("user_id", userId).eq("date", date);
  if (error) {
    throw new Error(`Failed to verify date availability: ${error.message}`);
  }
  const isRestDay = ((rows ?? []) as Array<{ data?: unknown }>).some((row) => {
    let payload = row.data;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }
    return parseRestDayMarkerPayload(payload) !== null;
  });
  if (isRestDay) {
    throw new Error("That date is marked as a rest day. Clear rest day first.");
  }
}

export async function addSingleWorkoutToUserDate(
  userId: string,
  input: AdminSingleWorkoutInput
): Promise<AdminSingleWorkoutResult> {
  noStore();
  const admin = getServiceRoleSupabase();
  const date = input.date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date format.");
  }
  await assertNotRestDay(userId, date, admin);
  const exercise = await resolveExerciseForSingleWorkout(userId, admin, input);
  const now = new Date().toISOString();

  if (input.mode === "planned") {
    const row = {
      user_id: userId,
      date,
      data: {
        workoutId: crypto.randomUUID(),
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        workoutDate: date,
        isDraft: true,
        sets: buildDraftSetsWithPrefill(exercise.setCount, input.prefill),
        sessionVolume: 0,
        sessionCps: null,
        progressionStage: "—",
        recommendation: "Added by admin — fill in set data when workout is completed.",
        submittedAt: now
      }
    };
    const { error } = await admin.from("workouts").insert(row);
    if (error) {
      throw new Error(`Failed to add planned workout: ${error.message}`);
    }
    return { addedCount: 1, date };
  }

  const sets = input.sets ?? [];
  if (sets.length === 0) {
    throw new Error("Completed set data is required.");
  }
  if (!canSubmitWorkoutInputs(sets, exercise.type, exercise.foundation)) {
    throw new Error(`Complete set 1 and fill every remaining required field for ${exercise.name} (use 0 where needed).`);
  }
  const performanceSets = sets.map((set) => ({ weight: set.weight, reps: set.reps }));
  const stage = calculateProgressionStage(performanceSets, exercise.targetReps, exercise.setCount);
  const recommendation = generateRecommendation(performanceSets, stage, exercise.targetReps, exercise.increment);
  const effectiveCpsSets = buildEffectiveCpsSets(performanceSets, exercise.foundation);
  const cpsInputSets =
    exercise.type === "time"
      ? sets.map((set) => ({
          weight: set.weight,
          reps: set.reps,
          timeSeconds: Number(set.timeSeconds ?? "")
        }))
      : effectiveCpsSets.map((set) => ({ ...set }));
  const sessionCps = calculateCPSWithOptions(cpsInputSets, exercise.targetReps, {
    exerciseType: exercise.type,
    targetTimeSeconds: exercise.targetReps,
    foundation: exercise.foundation
  });
  const row = {
    user_id: userId,
    date,
    data: {
      workoutId: crypto.randomUUID(),
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      workoutDate: date,
      isDraft: false,
      sets: sets.map((set) => normalizeHistoricalSetInput(set, exercise.type, exercise.trackRir, exercise.trackRpe)),
      sessionVolume: computeSessionVolumeFromSetInputs(sets),
      sessionCps,
      progressionStage: stage ?? "—",
      recommendation,
      submittedAt: now
    }
  };
  const { error } = await admin.from("workouts").insert(row);
  if (error) {
    throw new Error(`Failed to add historical workout: ${error.message}`);
  }
  return { addedCount: 1, date };
}

export async function updateUserWorkoutForAdmin(
  userId: string,
  workoutRowId: string,
  input: AdminUpdateWorkoutInput
): Promise<AdminUpdateWorkoutResult> {
  noStore();
  const admin = getServiceRoleSupabase();
  const date = input.date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date format.");
  }
  const { data: row, error } = await admin
    .from("workouts")
    .select("data")
    .eq("id", workoutRowId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load workout row: ${error.message}`);
  }
  if (!row) {
    throw new Error("Workout row not found.");
  }
  let payload: unknown = (row as { data?: unknown }).data ?? null;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = null;
    }
  }
  if (parseRestDayMarkerPayload(payload)) {
    throw new Error("Cannot edit rest day marker rows.");
  }
  const parsed = parseWorkoutEntryFromJson(payload, date);
  if (!parsed) {
    throw new Error("Workout row is unparseable.");
  }
  const { data: exerciseRows, error: exerciseError } = await admin
    .from("exercises")
    .select("data")
    .eq("user_id", userId);
  if (exerciseError) {
    throw new Error(`Failed to load exercises for workout edit: ${exerciseError.message}`);
  }
  const exercise = ((exerciseRows ?? []) as Array<{ data?: unknown }>)
    .map((r) => parseStoredExerciseRow(r))
    .filter((r): r is StoredUserExercise => Boolean(r))
    .find((r) => r.id === parsed.exerciseId);
  if (!exercise) {
    throw new Error("Exercise config for this workout was not found.");
  }

  let nextData: Record<string, unknown>;
  if (input.mode === "planned") {
    nextData = {
      ...payload as Record<string, unknown>,
      workoutDate: date,
      isDraft: true,
      sets: buildDraftSetsWithPrefill(exercise.setCount, input.prefill),
      sessionVolume: 0,
      sessionCps: null,
      progressionStage: "—",
      recommendation: "Updated by admin — fill in set data when workout is completed.",
      updatedAt: new Date().toISOString()
    };
  } else {
    const sets = input.sets ?? [];
    if (sets.length === 0) {
      throw new Error("Completed set data is required.");
    }
    if (!canSubmitWorkoutInputs(sets, exercise.type, exercise.foundation)) {
      throw new Error(`Complete set 1 and fill every remaining required field for ${exercise.name} (use 0 where needed).`);
    }
    const performanceSets = sets.map((set) => ({ weight: set.weight, reps: set.reps }));
    const stage = calculateProgressionStage(performanceSets, exercise.targetReps, exercise.setCount);
    const recommendation = generateRecommendation(performanceSets, stage, exercise.targetReps, exercise.increment);
    const effectiveCpsSets = buildEffectiveCpsSets(performanceSets, exercise.foundation);
    const cpsInputSets =
      exercise.type === "time"
        ? sets.map((set) => ({
            weight: set.weight,
            reps: set.reps,
            timeSeconds: Number(set.timeSeconds ?? "")
          }))
        : effectiveCpsSets.map((set) => ({ ...set }));
    const sessionCps = calculateCPSWithOptions(cpsInputSets, exercise.targetReps, {
      exerciseType: exercise.type,
      targetTimeSeconds: exercise.targetReps,
      foundation: exercise.foundation
    });
    nextData = {
      ...payload as Record<string, unknown>,
      workoutDate: date,
      isDraft: false,
      sets: sets.map((set) => normalizeHistoricalSetInput(set, exercise.type, exercise.trackRir, exercise.trackRpe)),
      sessionVolume: computeSessionVolumeFromSetInputs(sets),
      sessionCps,
      progressionStage: stage ?? "—",
      recommendation,
      updatedAt: new Date().toISOString()
    };
  }

  const { error: updateError } = await admin
    .from("workouts")
    .update({ date, data: nextData })
    .eq("id", workoutRowId)
    .eq("user_id", userId);
  if (updateError) {
    throw new Error(`Failed to update workout row: ${updateError.message}`);
  }
  return { updated: true };
}

export async function deleteUserWorkoutForAdmin(
  userId: string,
  workoutRowId: string
): Promise<AdminDeleteWorkoutResult> {
  noStore();
  const admin = getServiceRoleSupabase();
  const { error } = await admin.from("workouts").delete().eq("id", workoutRowId).eq("user_id", userId);
  if (error) {
    throw new Error(`Failed to delete workout row: ${error.message}`);
  }
  return { deleted: true };
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
