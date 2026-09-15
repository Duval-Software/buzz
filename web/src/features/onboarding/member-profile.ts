import { supabase } from "@/shared/lib/supabase";

export const interests = [
  ["vibe_coding", "Vibe coding"],
  ["software", "Software development"],
  ["ai_ml", "AI / ML"],
  ["design", "Design"],
  ["content", "Content creation"],
  ["hardware", "Hardware / robotics"],
  ["business", "Starting a business"],
  ["exploring", "Just exploring"],
] as const;
export type MemberProfile = {
  username: string;
  display_name: string;
  interests: string[];
  working_on: string;
};

/** Only the authenticated member's active first-party session can call this RPC. */
export async function memberProfileRequest(
  operation: "get" | "check" | "save",
  username?: string,
  profile?: MemberProfile,
) {
  if (!supabase)
    throw new Error("Account service is unavailable. Please retry.");
  const { data, error } = await supabase.rpc("creatorhive_profile", {
    operation,
    proposed_username: username ?? null,
    profile_data: profile ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}
