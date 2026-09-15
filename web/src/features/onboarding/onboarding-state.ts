import { relayWsUrl } from "@/shared/lib/relay-url";
import { supabase } from "@/shared/lib/supabase";
import type { User } from "@supabase/supabase-js";

// Only tour progress belongs here. Membership and permissions come from the relay.
const fallback = new Map<string, string>();
function key(pubkey: string) {
  return `creatorhive.onboarding.v1:${relayWsUrl()}:${pubkey}`;
}

/** Remember a new member's welcome flow, scoped to this community and browser. */
export function setOnboardingStatus(
  pubkey: string,
  status: "pending" | "done",
) {
  const id = key(pubkey);
  fallback.set(id, status);
  try {
    localStorage.setItem(id, status);
  } catch {
    // Storage restrictions must not prevent account creation or joining.
  }
}

/** Existing members are not interrupted unless they started a new-account flow. */
export function needsOnboarding(pubkey: string): boolean {
  const id = key(pubkey);
  try {
    return (fallback.get(id) ?? localStorage.getItem(id)) === "pending";
  } catch {
    return fallback.get(id) === "pending";
  }
}

/** Account metadata is tour progress only, never membership or paid access. */
export function syncManagedOnboarding(pubkey: string, user: User) {
  const completed = user.user_metadata?.creatorhive_onboarding?.[relayWsUrl()];
  setOnboardingStatus(pubkey, completed?.version === 1 ? "done" : "pending");
}

/** Remember completion across browsers before leaving the welcome flow. */
export async function completeManagedOnboarding() {
  if (!supabase)
    throw new Error("Account service is unavailable. Please retry.");
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Please sign in again to continue.");
  const { error: saveError } = await supabase.auth.updateUser({
    data: {
      creatorhive_onboarding: {
        ...data.user.user_metadata?.creatorhive_onboarding,
        [relayWsUrl()]: { version: 1, completed_at: new Date().toISOString() },
      },
    },
  });
  if (saveError) throw saveError;
}
