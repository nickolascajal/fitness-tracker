export type MasterExercise = {
  name: string;
  foundation: number;
  type: "weight" | "bodyweight" | "time";
};

export const EXERCISES_BY_LETTER: Readonly<Record<string, readonly MasterExercise[]>> = {
  A: [
    { name: "Arnold Press", foundation: 0, type: "weight" },
    { name: "Ab Wheel Rollout", foundation: 20, type: "bodyweight" }
  ],
  B: [
    { name: "Back Squat", foundation: 30, type: "bodyweight" },
    { name: "Bench Press", foundation: 0, type: "weight" },
    { name: "Bulgarian Split Squat", foundation: 30, type: "bodyweight" },
    { name: "Barbell Row", foundation: 0, type: "weight" },
    { name: "Bent Over Row", foundation: 0, type: "weight" },
    { name: "Bicep Curl (Barbell)", foundation: 0, type: "weight" },
    { name: "Bicep Curl (Dumbbell)", foundation: 0, type: "weight" }
  ],
  C: [
    { name: "Cable Fly", foundation: 0, type: "weight" },
    { name: "Cable Row", foundation: 0, type: "weight" },
    { name: "Chest Press (Machine)", foundation: 0, type: "weight" },
    { name: "Close Grip Bench Press", foundation: 0, type: "weight" },
    { name: "Concentration Curl", foundation: 0, type: "weight" },
    { name: "Crunch (Weighted)", foundation: 15, type: "bodyweight" }
  ],
  D: [
    { name: "Deadlift", foundation: 0, type: "weight" },
    { name: "Dumbbell Bench Press", foundation: 0, type: "weight" },
    { name: "Dumbbell Fly", foundation: 0, type: "weight" },
    { name: "Dumbbell Row", foundation: 0, type: "weight" },
    { name: "Decline Bench Press", foundation: 0, type: "weight" },
    { name: "Dead Hang", foundation: 30, type: "time" }
  ],
  E: [{ name: "EZ Bar Curl", foundation: 0, type: "weight" }],
  F: [
    { name: "Front Squat", foundation: 30, type: "bodyweight" },
    { name: "Face Pull", foundation: 0, type: "weight" },
    { name: "Farmer Carry", foundation: 0, type: "time" }
  ],
  G: [
    { name: "Goblet Squat", foundation: 30, type: "bodyweight" },
    { name: "Glute Bridge", foundation: 30, type: "bodyweight" }
  ],
  H: [
    { name: "Hack Squat", foundation: 0, type: "weight" },
    { name: "Hammer Curl", foundation: 0, type: "weight" },
    { name: "Hip Thrust", foundation: 30, type: "bodyweight" },
    { name: "Hollow Hold", foundation: 20, type: "time" }
  ],
  I: [
    { name: "Incline Bench Press", foundation: 0, type: "weight" },
    { name: "Incline Dumbbell Press", foundation: 0, type: "weight" }
  ],
  K: [{ name: "Kettlebell Swing", foundation: 0, type: "weight" }],
  L: [
    { name: "Lat Pulldown", foundation: 0, type: "weight" },
    { name: "Leg Press", foundation: 0, type: "weight" },
    { name: "Leg Extension", foundation: 0, type: "weight" },
    { name: "Leg Curl (Seated)", foundation: 0, type: "weight" },
    { name: "Leg Curl (Lying)", foundation: 0, type: "weight" },
    { name: "Lateral Raise", foundation: 0, type: "weight" },
    { name: "Lunges", foundation: 30, type: "bodyweight" }
  ],
  M: [{ name: "Machine Row", foundation: 0, type: "weight" }],
  O: [{ name: "Overhead Press", foundation: 0, type: "weight" }],
  P: [
    { name: "Pull-Up", foundation: 40, type: "bodyweight" },
    { name: "Push-Up (Weighted)", foundation: 35, type: "bodyweight" },
    { name: "Pec Deck", foundation: 0, type: "weight" },
    { name: "Preacher Curl", foundation: 0, type: "weight" },
    { name: "Plank", foundation: 20, type: "time" }
  ],
  R: [
    { name: "Romanian Deadlift", foundation: 0, type: "weight" },
    { name: "Reverse Fly", foundation: 0, type: "weight" },
    { name: "Reverse Curl", foundation: 0, type: "weight" }
  ],
  S: [
    { name: "Squat", foundation: 30, type: "bodyweight" },
    { name: "Smith Machine Squat", foundation: 30, type: "bodyweight" },
    { name: "Shoulder Press (Machine)", foundation: 0, type: "weight" },
    { name: "Shrugs", foundation: 0, type: "weight" },
    { name: "Skull Crushers", foundation: 0, type: "weight" },
    { name: "Step-Ups", foundation: 30, type: "bodyweight" },
    { name: "Side Plank", foundation: 20, type: "time" },
    { name: "Suitcase Carry", foundation: 0, type: "time" }
  ],
  T: [
    { name: "Tricep Pushdown", foundation: 0, type: "weight" },
    { name: "Tricep Extension (Overhead)", foundation: 0, type: "weight" },
    { name: "T-Bar Row", foundation: 0, type: "weight" }
  ],
  W: [
    { name: "Walking Lunges", foundation: 30, type: "bodyweight" },
    { name: "Wrist Curl", foundation: 0, type: "weight" },
    { name: "Wall Sit", foundation: 30, type: "time" }
  ]
} as const;

function masterExerciseNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function getMasterExerciseByName(name: string): MasterExercise | undefined {
  const key = masterExerciseNameKey(name);
  for (const entries of Object.values(EXERCISES_BY_LETTER)) {
    for (const entry of entries) {
      if (masterExerciseNameKey(entry.name) === key) return entry;
    }
  }
  return undefined;
}
