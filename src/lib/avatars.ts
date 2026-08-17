/**
 * Avatars.
 *
 * A photograph of a child is the most sensitive thing this system can hold, so
 * it must never feel like the expected choice. These exist so that a family
 * declining to upload one gets an account that looks exactly as complete and
 * exactly as cheerful as everybody else's.
 *
 * Rendered as a coloured disc with a character on it — no image files, nothing
 * to upload, nothing to leak, and it works offline and at any size.
 */

export interface AvatarDefinition {
  key: string;
  label: string;
  glyph: string;
  /** Background. All are dark enough to carry the white ring at 3:1. */
  color: string;
}

export const AVATARS: readonly AvatarDefinition[] = [
  { key: "fox", label: "Fox", glyph: "🦊", color: "#B23A16" },
  { key: "owl", label: "Owl", glyph: "🦉", color: "#7A5C2E" },
  { key: "cat", label: "Cat", glyph: "🐱", color: "#8A5A00" },
  { key: "turtle", label: "Turtle", glyph: "🐢", color: "#1F6F5C" },
  { key: "rocket", label: "Rocket", glyph: "🚀", color: "#14574A" },
  { key: "dragon", label: "Dragon", glyph: "🐲", color: "#2F7D32" },
  { key: "whale", label: "Whale", glyph: "🐳", color: "#2A5D8F" },
  { key: "star", label: "Star", glyph: "⭐", color: "#6B4E9B" },
  { key: "bookworm", label: "Bookworm", glyph: "🐛", color: "#5C7A1F" },
  { key: "panda", label: "Panda", glyph: "🐼", color: "#4A4A4A" },
  { key: "rabbit", label: "Rabbit", glyph: "🐰", color: "#9B4B6B" },
  { key: "elephant", label: "Elephant", glyph: "🐘", color: "#4F5B78" },
] as const;

export const DEFAULT_AVATAR_KEY = "bookworm";

export const AVATAR_KEYS: readonly string[] = AVATARS.map((avatar) => avatar.key);

export function isAvatarKey(value: unknown): value is string {
  return typeof value === "string" && AVATAR_KEYS.includes(value);
}

/** Never returns undefined: an unknown key falls back rather than rendering nothing. */
export function getAvatar(key: string | null | undefined): AvatarDefinition {
  return (
    AVATARS.find((avatar) => avatar.key === key) ??
    AVATARS.find((avatar) => avatar.key === DEFAULT_AVATAR_KEY)!
  );
}
