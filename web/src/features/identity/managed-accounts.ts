import type { OwnModeration } from "@/features/moderation/api";
import { supabase } from "@/shared/lib/supabase";
import { loadIdentity, setManagedIdentity } from "@/shared/lib/identity";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";
import { getSocket } from "@/shared/lib/nostr-socket";
import type { Session } from "@supabase/supabase-js";
import { syncManagedOnboarding } from "@/features/onboarding/onboarding-state";

export async function managedRequest(
  path: string,
  body: unknown,
  accessToken?: string,
) {
  if (!supabase) throw new Error("Account service is not configured.");
  const token =
    accessToken ??
    (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("Please sign in to continue.");
  const response = await fetch(
    import.meta.env.DEV
      ? `/api/identity/${path}`
      : `${relayHttpBaseUrl().replace(/\/$/, "")}/api/identity/${path}`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      data?.error ??
        (path.startsWith("profile/")
          ? response.status === 404
            ? "Profiles aren’t available on this server yet. Please retry shortly."
            : "Could not load or save your profile. Please retry."
          : "Account service is unavailable. Please retry."),
    );
  }
  return response.status === 204 ? null : response.json();
}

/** Discard stale callback results when a newer session wins or the user signs out. */
export async function bootstrapManagedAccount(
  session: Session,
  stillCurrent: () => boolean,
) {
  const data = await managedRequest("bootstrap", {}, session.access_token);
  if (!stillCurrent()) return;
  if (
    data?.restrictions &&
    (data.restrictions.banned || data.restrictions.rename_required)
  )
    return data.restrictions as OwnModeration;
  if (
    !data ||
    data.accountId !== session.user.id ||
    !/^[0-9a-f]{64}$/.test(data.pubkey) ||
    !/^[0-9a-f]{64}$/.test(data.sessionToken) ||
    !Number.isFinite(data.expiresAt)
  ) {
    throw new Error("Could not prepare your account. Please retry.");
  }
  syncManagedOnboarding(data.pubkey, session.user);
  setManagedIdentity(data, session.user.email);
  getSocket(relayWsUrl()).reconnect();
}

export async function signOutManagedAccount() {
  if (!supabase) throw new Error("Account service is not configured.");
  if (loadIdentity()) await managedRequest("logout", {});
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw error;
}
