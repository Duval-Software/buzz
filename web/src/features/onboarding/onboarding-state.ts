import { relayWsUrl } from "@/shared/lib/relay-url";

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
