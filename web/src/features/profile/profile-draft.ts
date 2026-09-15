import type { PublicProfile } from "./public-profile";

/** Only editable presentation fields belong in a recoverable tab draft. */
export function profileDraft(profile: PublicProfile) {
  const {
    display_name,
    bio,
    build_status = "",
    build_url = "",
    interests,
    accent,
    collaborating,
    links,
    highlights,
    avatar,
    cover,
    visibility,
  } = profile;
  return {
    display_name,
    bio,
    build_status,
    build_url,
    interests,
    accent,
    collaborating,
    links,
    highlights,
    avatar,
    cover,
    visibility,
  };
}

export function restoreProfileDraft(
  profile: PublicProfile,
  draft: string,
): PublicProfile {
  if (!draft) return profile;
  try {
    const value = JSON.parse(draft);
    if (!value || typeof value !== "object") return profile;
    const text = (v: unknown) => typeof v === "string";
    const image = (v: unknown) => v === null || text(v);
    if (
      ![
        value.display_name,
        value.bio,
        value.build_status,
        value.build_url,
      ].every(text) ||
      !["honey", "sage", "sky", "lavender", "rose", "sand"].includes(
        value.accent,
      ) ||
      !["public", "members"].includes(value.visibility) ||
      typeof value.collaborating !== "boolean" ||
      !image(value.avatar) ||
      !image(value.cover) ||
      !Array.isArray(value.interests) ||
      !value.interests.every(text) ||
      !Array.isArray(value.links) ||
      value.links.length > 5 ||
      !value.links.every(
        (link: { label?: unknown; url?: unknown } | null) =>
          link && text(link.label) && text(link.url),
      ) ||
      !Array.isArray(value.highlights) ||
      value.highlights.length > 6 ||
      !value.highlights.every(
        (h: Record<string, unknown> | null) =>
          h &&
          (h.kind === "pulse"
            ? text(h.event_id) &&
              (h.text === undefined || text(h.text)) &&
              (h.created_at === undefined || typeof h.created_at === "number")
            : h.kind === "project" &&
              text(h.title) &&
              text(h.description) &&
              text(h.url) &&
              image(h.image)),
      )
    )
      return profile;
    // Server-owned identity, publication and access flags always come from the fresh response.
    return { ...profile, ...profileDraft(value) };
  } catch {
    return profile;
  }
}
