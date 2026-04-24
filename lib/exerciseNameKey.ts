/**
 * Canonical key for comparing a master-list or UI exercise name to the
 * user’s saved exercises. Not for display.
 */
export function exerciseNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Duplicate-check key for user-entered exercise names.
 * Comparison ignores case, spaces, and hyphens, but otherwise requires exact characters.
 */
export function exerciseDuplicateKey(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "");
}
