import { supabase } from "@/shared/lib/supabase";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";
import { managedRequest } from "@/features/identity/managed-accounts";

export const accents = {
  honey: "#e8bb71",
  sage: "#a3c9ad",
  sky: "#90bee9",
  lavender: "#b8a7e8",
  rose: "#e7a2b0",
  sand: "#d4c4ab",
} as const;
export type Highlight =
  | {
      kind: "project";
      title: string;
      description: string;
      url: string;
      image: string | null;
    }
  | { kind: "pulse"; event_id: string; text?: string; created_at?: number };
export type Presentation = {
  display_name: string;
  bio: string;
  build_status?: string;
  build_url?: string;
  interests: string[];
  accent: keyof typeof accents;
  collaborating: boolean;
  links: { label: string; url: string }[];
  highlights: Highlight[];
  avatar: string | null;
  cover: string | null;
};
export type PublicProfile = Presentation & {
  username: string;
  visibility: "public" | "members";
  published: boolean;
  owner?: boolean;
  member_key?: string;
  publication_enabled?: boolean;
};
export function profileApi(path: string) {
  return `${import.meta.env.DEV ? "" : relayHttpBaseUrl().replace(/\/$/, "")}/api/${path}`;
}
export async function profileFetch(
  path: string,
  options: RequestInit = {},
  anonymous = false,
) {
  const token = anonymous
    ? null
    : (await supabase?.auth.getSession())?.data.session?.access_token;
  const response = await fetch(profileApi(path), {
    ...options,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error ?? "Profile unavailable. Please retry.");
  }
  return response;
}
export async function readPublicProfile(
  username: string,
  anonymous = false,
): Promise<PublicProfile> {
  return (
    await profileFetch(
      `profiles/${encodeURIComponent(username)}`,
      {},
      anonymous,
    )
  ).json();
}
export function ownPublicProfile(): Promise<PublicProfile> {
  return managedRequest("profile/own", {});
}
export async function savePublicProfile(profile: PublicProfile) {
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
  } = profile;
  // Only source references go back to the server; rendered Pulse content is never writable here.
  const selections = highlights.map((h) =>
    h.kind === "pulse" ? { kind: "pulse", event_id: h.event_id } : h,
  );
  return managedRequest("profile/save", {
    published: true,
    visibility: profile.visibility,
    presentation: {
      display_name,
      bio,
      build_status,
      build_url,
      interests,
      accent,
      collaborating,
      links,
      highlights: selections,
      avatar,
      cover,
    },
  });
}
export function searchProfileMembers(
  query: string,
): Promise<{ username: string; display_name: string }[]> {
  return managedRequest("profile/search", { query });
}
export async function uploadProfileImage(file: File): Promise<string> {
  if (
    file.size > 5 * 1024 * 1024 ||
    !["image/jpeg", "image/png", "image/webp"].includes(file.type)
  )
    throw new Error("Choose a JPEG, PNG or WebP smaller than 5 MB.");
  const response = await profileFetch("identity/profile/image", {
    method: "POST",
    body: file,
    headers: { "Content-Type": file.type },
  });
  return (await response.json()).id;
}
