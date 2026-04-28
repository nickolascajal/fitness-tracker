"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useBodyweight } from "@/app/bodyweight-provider";
import { actionButtonClasses } from "@/components/action-button";
import { toSundayYmd, type BodyweightUnit } from "@/lib/bodyweight";

function shortUserId(userId: string): string {
  if (userId.length <= 12) return userId;
  return `${userId.slice(0, 8)}...${userId.slice(-4)}`;
}

export default function ProfilePage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [name, setName] = useState("");
  const [ageInput, setAgeInput] = useState("");
  const [userEmail, setUserEmail] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [profileMessage, setProfileMessage] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [bodyweightInput, setBodyweightInput] = useState("");
  const [bodyweightUnit, setBodyweightUnit] = useState<BodyweightUnit>("lbs");
  const [bodyweightMessage, setBodyweightMessage] = useState("");
  const [bodyweightSaving, setBodyweightSaving] = useState(false);
  const { getLatestBodyweight, listBodyweightLogs, upsertWeeklyBodyweight } = useBodyweight();

  useEffect(() => {
    const guardRoute = async () => {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/");
        setAuthChecked(true);
        return;
      }

      setUserEmail(user.email ?? "");
      setUserId(user.id);
      setName(typeof user.user_metadata?.name === "string" ? user.user_metadata.name : "");
      const ageMeta = user.user_metadata?.age;
      if (typeof ageMeta === "number" && Number.isFinite(ageMeta)) {
        setAgeInput(String(ageMeta));
      } else if (typeof ageMeta === "string" && ageMeta.trim() !== "") {
        setAgeInput(ageMeta);
      } else {
        setAgeInput("");
      }
      setAuthChecked(true);
    };

    void guardRoute();
  }, [router]);

  const displayUserId = useMemo(() => shortUserId(userId), [userId]);
  const latestBodyweight = useMemo(() => getLatestBodyweight(), [getLatestBodyweight]);
  const profileWeekDate = useMemo(() => toSundayYmd(new Date()), []);
  const profileWeekBodyweight = useMemo(
    () => listBodyweightLogs().find((log) => log.weekDate === profileWeekDate) ?? null,
    [listBodyweightLogs, profileWeekDate]
  );

  useEffect(() => {
    if (!latestBodyweight) return;
    setBodyweightUnit(latestBodyweight.unit);
    setBodyweightInput(String(latestBodyweight.bodyweight));
  }, [latestBodyweight]);

  const handleSaveProfile = async () => {
    const trimmedName = name.trim();
    const trimmedAge = ageInput.trim();

    let parsedAge: number | null = null;
    if (trimmedAge !== "") {
      const n = Number(trimmedAge);
      if (!Number.isFinite(n) || n < 0 || n > 120) {
        setProfileMessage("Age must be a valid number between 0 and 120.");
        return;
      }
      parsedAge = Math.floor(n);
    }

    setProfileSaving(true);
    setProfileMessage("");
    const payload: { name: string; age?: number } = { name: trimmedName };
    if (parsedAge !== null) {
      payload.age = parsedAge;
    }

    const { error } = await supabase.auth.updateUser({
      data: payload
    });

    if (error) {
      console.error("Profile update error:", error);
      setProfileMessage("Something went wrong. Please try again.");
      setProfileSaving(false);
      return;
    }

    setProfileMessage("Profile updated successfully.");
    setProfileSaving(false);
  };

  const handleChangePassword = async () => {
    if (!currentPassword) {
      setPasswordMessage("Please enter your current password.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMessage("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordMessage("New passwords do not match.");
      return;
    }
    if (!userEmail) {
      setPasswordMessage("Something went wrong. Please try again.");
      return;
    }

    setPasswordSaving(true);
    setPasswordMessage("");

    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password: currentPassword
    });
    if (verifyError) {
      console.error("Current password verification error:", verifyError);
      setPasswordMessage("Current password is incorrect.");
      setPasswordSaving(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword
    });
    if (updateError) {
      console.error("Password update error:", updateError);
      setPasswordMessage("Something went wrong. Please try again.");
      setPasswordSaving(false);
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setPasswordMessage("Password updated successfully.");
    setPasswordSaving(false);
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Sign out error:", error);
      return;
    }
    router.push("/login");
  };

  const handleSaveBodyweight = async () => {
    const parsed = Number(bodyweightInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setBodyweightMessage("Enter a valid bodyweight.");
      return;
    }
    setBodyweightSaving(true);
    setBodyweightMessage("");
    await upsertWeeklyBodyweight(profileWeekDate, parsed, bodyweightUnit);
    setBodyweightSaving(false);
    setBodyweightMessage("Bodyweight updated.");
  };

  if (!authChecked || !userId) {
    return null;
  }

  return (
    <section className="space-y-5 pt-1 md:pt-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Profile</h1>
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Account</h2>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Age</span>
            <input
              type="number"
              min={0}
              max={120}
              value={ageInput}
              onChange={(event) => setAgeInput(event.target.value)}
              placeholder="Optional"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</p>
          <p className="mt-1 text-sm text-slate-900">{userEmail || "—"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">User ID</p>
          <p className="mt-1 text-sm text-slate-900">{displayUserId}</p>
        </div>
        <button
          type="button"
          onClick={handleSaveProfile}
          className={actionButtonClasses.primary}
          disabled={profileSaving}
        >
          {profileSaving ? "Saving..." : "Save Profile"}
        </button>
        {profileMessage ? <p className="text-sm text-slate-600">{profileMessage}</p> : null}
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Change Password</h2>
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">New Password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Confirm New Password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmNewPassword}
            onChange={(event) => setConfirmNewPassword(event.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <button
          type="button"
          onClick={handleChangePassword}
          className={actionButtonClasses.primary}
          disabled={passwordSaving}
        >
          {passwordSaving ? "Updating..." : "Update Password"}
        </button>
        {passwordMessage ? <p className="text-sm text-slate-600">{passwordMessage}</p> : null}
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Bodyweight</h2>
        <p className="text-sm text-slate-700">
          Latest bodyweight:{" "}
          <span className="font-semibold text-slate-900">
            {latestBodyweight ? `${latestBodyweight.bodyweight} ${latestBodyweight.unit}` : "—"}
          </span>
        </p>
        <p className="text-xs text-slate-500">
          {profileWeekBodyweight
            ? `Logged this week: ${profileWeekBodyweight.bodyweight} ${profileWeekBodyweight.unit}`
            : latestBodyweight
              ? `Using last logged bodyweight: ${latestBodyweight.bodyweight} ${latestBodyweight.unit}`
              : "No bodyweight logged yet."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={0}
            step={0.1}
            value={bodyweightInput}
            onChange={(event) => setBodyweightInput(event.target.value)}
            placeholder="Bodyweight"
            className="w-32 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
          <select
            value={bodyweightUnit}
            onChange={(event) => setBodyweightUnit(event.target.value as BodyweightUnit)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            <option value="lbs">lbs</option>
            <option value="kg">kg</option>
          </select>
          <button
            type="button"
            onClick={() => {
              void handleSaveBodyweight();
            }}
            className={actionButtonClasses.primary}
            disabled={bodyweightSaving}
          >
            {bodyweightSaving ? "Saving..." : "Update bodyweight"}
          </button>
        </div>
        <p className="text-xs text-slate-500">Optional and used for future performance context.</p>
        {bodyweightMessage ? <p className="text-sm text-slate-600">{bodyweightMessage}</p> : null}
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <button type="button" onClick={handleSignOut} className={actionButtonClasses.secondary}>
          Log out
        </button>
      </div>
    </section>
  );
}
