"use server";

import { createClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";
import {
  addSingleWorkoutToUserDate,
  type AdminDraftPrefillByExercise,
  deleteUserWorkoutForAdmin,
  getRestDatesForUser,
  getUserExerciseConfigsForAdmin,
  setRestDayForUser,
  addHistoricalPresetWorkoutsToUserDate,
  assignPresetDraftsToUserDate,
  cleanupOrphanedRows,
  createPresetForUser,
  getAssignablePresetsForUser,
  getAdminOverview,
  getUserWorkoutsForAdmin,
  type AdminAddHistoricalPresetInput,
  type AdminAddHistoricalResult,
  type AdminDeleteWorkoutResult,
  type AdminCreatePresetInput,
  type AdminCreatePresetResult,
  type AdminAssignablePreset,
  type AdminOrphanCleanupResult,
  type AdminAssignPresetResult,
  type AdminSingleWorkoutInput,
  type AdminSingleWorkoutResult,
  type AdminUpdateWorkoutInput,
  type AdminUpdateWorkoutResult,
  type AdminUserExerciseConfig,
  type AdminOverview,
  type AdminUserWorkoutRow,
  updateUserWorkoutForAdmin
} from "./queries";

export type AdminOverviewActionResult =
  | { ok: true; data: AdminOverview }
  | {
      ok: false;
      code: "no_token" | "invalid_token" | "not_admin" | "config" | "data";
      message: string;
    };

export type AdminUserWorkoutsActionResult =
  | { ok: true; data: AdminUserWorkoutRow[] }
  | {
      ok: false;
      code: "no_token" | "invalid_token" | "not_admin" | "config" | "data" | "bad_request";
      message: string;
    };

export type AdminCleanupOrphansActionResult =
  | { ok: true; data: AdminOrphanCleanupResult }
  | {
      ok: false;
      code: "no_token" | "invalid_token" | "not_admin" | "config" | "data";
      message: string;
    };

export type AdminAssignablePresetsActionResult =
  | { ok: true; data: AdminAssignablePreset[] }
  | {
      ok: false;
      code: "no_token" | "invalid_token" | "not_admin" | "config" | "data" | "bad_request";
      message: string;
    };

export type AdminAssignPresetActionResult =
  | { ok: true; data: AdminAssignPresetResult }
  | {
      ok: false;
      code: "no_token" | "invalid_token" | "not_admin" | "config" | "data" | "bad_request";
      message: string;
    };

export type AdminRestDatesActionResult =
  | { ok: true; data: { restDates: string[] } }
  | {
      ok: false;
      code: "no_token" | "invalid_token" | "not_admin" | "config" | "data" | "bad_request";
      message: string;
    };

export type AdminCreatePresetActionResult =
  | { ok: true; data: AdminCreatePresetResult }
  | {
      ok: false;
      code: "no_token" | "invalid_token" | "not_admin" | "config" | "data" | "bad_request";
      message: string;
    };

export type AdminAddHistoricalActionResult =
  | { ok: true; data: AdminAddHistoricalResult }
  | {
      ok: false;
      code: "no_token" | "invalid_token" | "not_admin" | "config" | "data" | "bad_request";
      message: string;
    };

export type AdminUserExerciseConfigsActionResult =
  | { ok: true; data: AdminUserExerciseConfig[] }
  | {
      ok: false;
      code: "no_token" | "invalid_token" | "not_admin" | "config" | "data" | "bad_request";
      message: string;
    };

export type AdminSingleWorkoutActionResult =
  | { ok: true; data: AdminSingleWorkoutResult }
  | {
      ok: false;
      code: "no_token" | "invalid_token" | "not_admin" | "config" | "data" | "bad_request";
      message: string;
    };

export type AdminUpdateWorkoutActionResult =
  | { ok: true; data: AdminUpdateWorkoutResult }
  | {
      ok: false;
      code: "no_token" | "invalid_token" | "not_admin" | "config" | "data" | "bad_request";
      message: string;
    };

export type AdminDeleteWorkoutActionResult =
  | { ok: true; data: AdminDeleteWorkoutResult }
  | {
      ok: false;
      code: "no_token" | "invalid_token" | "not_admin" | "config" | "data" | "bad_request";
      message: string;
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function assertAdminSessionOnServer(accessToken: string): Promise<
  { ok: true } | { ok: false; code: "no_token" | "invalid_token" | "not_admin" | "config"; message: string }
> {
  if (!accessToken.trim()) {
    return { ok: false, code: "no_token", message: "Missing access token." };
  }

  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!adminEmail) {
    return { ok: false, code: "config", message: "ADMIN_EMAIL is not configured." };
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false,
      code: "config",
      message: "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not configured."
    };
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return {
      ok: false,
      code: "config",
      message: "SUPABASE_SERVICE_ROLE_KEY is not configured on the server."
    };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const {
    data: { user },
    error
  } = await supabase.auth.getUser(accessToken);

  if (error || !user?.email) {
    return {
      ok: false,
      code: "invalid_token",
      message: "Server could not validate the provided access token."
    };
  }

  if (user.email.trim().toLowerCase() !== adminEmail) {
    return { ok: false, code: "not_admin", message: "Not authorized for admin data." };
  }

  return { ok: true };
}

/** Loads overview after server-side session + admin email check (service role queries stay server-only). */
export async function fetchAdminOverviewAction(accessToken: string): Promise<AdminOverviewActionResult> {
  noStore();
  const gate = await assertAdminSessionOnServer(accessToken);
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message };
  }

  try {
    const data = await getAdminOverview();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      code: "data",
      message: "Admin data could not be loaded. Check server logs and SUPABASE_SERVICE_ROLE_KEY."
    };
  }
}

/** Loads one user’s workouts for admin detail (same server gate as overview). */
export async function fetchAdminUserWorkoutsAction(
  userId: string,
  accessToken: string
): Promise<AdminUserWorkoutsActionResult> {
  noStore();
  if (!UUID_RE.test(userId)) {
    return { ok: false, code: "bad_request", message: "Invalid user id." };
  }

  const gate = await assertAdminSessionOnServer(accessToken);
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message };
  }

  try {
    const data = await getUserWorkoutsForAdmin(userId);
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      code: "data",
      message: "Could not load workouts. Check server configuration."
    };
  }
}

export async function cleanupAdminOrphanedRowsAction(
  accessToken: string
): Promise<AdminCleanupOrphansActionResult> {
  noStore();
  const gate = await assertAdminSessionOnServer(accessToken);
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message };
  }

  try {
    const data = await cleanupOrphanedRows();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      code: "data",
      message: "Could not clean up orphaned rows. Check server logs."
    };
  }
}

export async function fetchAdminAssignablePresetsAction(
  userId: string,
  accessToken: string
): Promise<AdminAssignablePresetsActionResult> {
  noStore();
  if (!UUID_RE.test(userId)) {
    return { ok: false, code: "bad_request", message: "Invalid user id." };
  }

  const gate = await assertAdminSessionOnServer(accessToken);
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message };
  }

  try {
    const data = await getAssignablePresetsForUser(userId);
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      code: "data",
      message: "Could not load assignable presets for this user."
    };
  }
}

export async function assignAdminPresetToUserDateAction(
  userId: string,
  presetId: string,
  date: string,
  accessToken: string,
  prefilledByExercise: AdminDraftPrefillByExercise[] = []
): Promise<AdminAssignPresetActionResult> {
  noStore();
  if (!UUID_RE.test(userId)) {
    return { ok: false, code: "bad_request", message: "Invalid user id." };
  }
  if (!presetId.trim()) {
    return { ok: false, code: "bad_request", message: "Preset is required." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, code: "bad_request", message: "Invalid date format." };
  }

  const gate = await assertAdminSessionOnServer(accessToken);
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message };
  }

  try {
    const data = await assignPresetDraftsToUserDate(userId, presetId, date, prefilledByExercise);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      code: "data",
      message:
        error instanceof Error && error.message
          ? error.message
          : "Could not assign preset workouts to this user."
    };
  }
}

export async function fetchAdminUserRestDatesAction(
  userId: string,
  accessToken: string
): Promise<AdminRestDatesActionResult> {
  noStore();
  if (!UUID_RE.test(userId)) {
    return { ok: false, code: "bad_request", message: "Invalid user id." };
  }
  const gate = await assertAdminSessionOnServer(accessToken);
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message };
  }
  try {
    const restDates = await getRestDatesForUser(userId);
    return { ok: true, data: { restDates } };
  } catch (error) {
    return {
      ok: false,
      code: "data",
      message: error instanceof Error && error.message ? error.message : "Could not load rest dates."
    };
  }
}

export async function setAdminUserRestDayAction(
  userId: string,
  date: string,
  isRest: boolean,
  accessToken: string
): Promise<AdminRestDatesActionResult> {
  noStore();
  if (!UUID_RE.test(userId)) {
    return { ok: false, code: "bad_request", message: "Invalid user id." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, code: "bad_request", message: "Invalid date format." };
  }
  const gate = await assertAdminSessionOnServer(accessToken);
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message };
  }
  try {
    await setRestDayForUser(userId, date, isRest);
    const restDates = await getRestDatesForUser(userId);
    return { ok: true, data: { restDates } };
  } catch (error) {
    return {
      ok: false,
      code: "data",
      message: error instanceof Error && error.message ? error.message : "Could not update rest day."
    };
  }
}

export async function createAdminPresetForUserAction(
  userId: string,
  input: AdminCreatePresetInput,
  accessToken: string
): Promise<AdminCreatePresetActionResult> {
  noStore();
  if (!UUID_RE.test(userId)) {
    return { ok: false, code: "bad_request", message: "Invalid user id." };
  }
  if (!input || typeof input !== "object") {
    return { ok: false, code: "bad_request", message: "Invalid preset payload." };
  }

  const gate = await assertAdminSessionOnServer(accessToken);
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message };
  }

  try {
    const data = await createPresetForUser(userId, input);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      code: "data",
      message:
        error instanceof Error && error.message
          ? error.message
          : "Could not create preset for this user."
    };
  }
}

export async function addAdminHistoricalPresetToUserDateAction(
  userId: string,
  input: AdminAddHistoricalPresetInput,
  accessToken: string
): Promise<AdminAddHistoricalActionResult> {
  noStore();
  if (!UUID_RE.test(userId)) {
    return { ok: false, code: "bad_request", message: "Invalid user id." };
  }
  if (!input || typeof input !== "object") {
    return { ok: false, code: "bad_request", message: "Invalid historical payload." };
  }

  const gate = await assertAdminSessionOnServer(accessToken);
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message };
  }

  try {
    const data = await addHistoricalPresetWorkoutsToUserDate(userId, input);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      code: "data",
      message:
        error instanceof Error && error.message
          ? error.message
          : "Could not add historical workouts for this user."
    };
  }
}

export async function fetchAdminUserExerciseConfigsAction(
  userId: string,
  accessToken: string
): Promise<AdminUserExerciseConfigsActionResult> {
  noStore();
  if (!UUID_RE.test(userId)) {
    return { ok: false, code: "bad_request", message: "Invalid user id." };
  }
  const gate = await assertAdminSessionOnServer(accessToken);
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message };
  }
  try {
    const data = await getUserExerciseConfigsForAdmin(userId);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      code: "data",
      message: error instanceof Error && error.message ? error.message : "Could not load exercise configs."
    };
  }
}

export async function addAdminSingleWorkoutToUserDateAction(
  userId: string,
  input: AdminSingleWorkoutInput,
  accessToken: string
): Promise<AdminSingleWorkoutActionResult> {
  noStore();
  if (!UUID_RE.test(userId)) {
    return { ok: false, code: "bad_request", message: "Invalid user id." };
  }
  if (!input || typeof input !== "object") {
    return { ok: false, code: "bad_request", message: "Invalid workout payload." };
  }
  const gate = await assertAdminSessionOnServer(accessToken);
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message };
  }
  try {
    const data = await addSingleWorkoutToUserDate(userId, input);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      code: "data",
      message: error instanceof Error && error.message ? error.message : "Could not add workout."
    };
  }
}

export async function updateAdminUserWorkoutAction(
  userId: string,
  workoutRowId: string,
  input: AdminUpdateWorkoutInput,
  accessToken: string
): Promise<AdminUpdateWorkoutActionResult> {
  noStore();
  if (!UUID_RE.test(userId)) {
    return { ok: false, code: "bad_request", message: "Invalid user id." };
  }
  if (!workoutRowId.trim()) {
    return { ok: false, code: "bad_request", message: "Workout row id is required." };
  }
  const gate = await assertAdminSessionOnServer(accessToken);
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message };
  }
  try {
    const data = await updateUserWorkoutForAdmin(userId, workoutRowId, input);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      code: "data",
      message: error instanceof Error && error.message ? error.message : "Could not update workout."
    };
  }
}

export async function deleteAdminUserWorkoutAction(
  userId: string,
  workoutRowId: string,
  accessToken: string
): Promise<AdminDeleteWorkoutActionResult> {
  noStore();
  if (!UUID_RE.test(userId)) {
    return { ok: false, code: "bad_request", message: "Invalid user id." };
  }
  if (!workoutRowId.trim()) {
    return { ok: false, code: "bad_request", message: "Workout row id is required." };
  }
  const gate = await assertAdminSessionOnServer(accessToken);
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message };
  }
  try {
    const data = await deleteUserWorkoutForAdmin(userId, workoutRowId);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      code: "data",
      message: error instanceof Error && error.message ? error.message : "Could not delete workout."
    };
  }
}
