import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/shared/lib/supabase";
import type {
  OAuthGrant,
  OAuthAuthorizationDetails,
} from "@supabase/supabase-js";

export function ConnectedApps() {
  const [grants, setGrants] = useState<OAuthGrant[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry reloads provider grants.
  useEffect(() => {
    let current = true;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        if (!supabase) throw new Error("Connected apps are unavailable.");
        const { data, error } = await supabase.auth.oauth.listGrants();
        if (error) throw error;
        if (current) setGrants(data ?? []);
      } catch {
        if (current) setError("Could not load connected apps. Try again.");
      } finally {
        if (current) setBusy(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [retry]);
  return (
    <section className="mt-5">
      <h3 className="font-semibold">Connected apps</h3>
      {busy && <p role="status">Loading connected apps…</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => setRetry((n) => n + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {!busy && !error && grants.length === 0 && (
        <p>No apps have access to your account.</p>
      )}
      {grants.map((grant) => (
        <div
          key={grant.client.id}
          className="mt-3 flex items-center justify-between gap-3"
        >
          <div>
            <strong>{grant.client.name}</strong>
            <p className="text-sm">{grant.scopes.join(", ")}</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!supabase) return;
              setBusy(true);
              setError("");
              try {
                const { error } = await supabase.auth.oauth.revokeGrant({
                  clientId: grant.client.id,
                });
                if (error) throw error;
                setGrants((previous) =>
                  previous.filter((g) => g.client.id !== grant.client.id),
                );
              } catch {
                setError("Could not remove access. Try again.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove access
          </button>
        </div>
      ))}
    </section>
  );
}

/** Uses Supabase's authorization record, never untrusted query-string app labels. */
export function CreatorHiveConsent({
  authorizationId,
}: {
  authorizationId: string;
}) {
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const returnToApp = useCallback((url: string) => {
    const target = new URL(url);
    if (
      target.origin !== "https://sso-demo.creatorhive.ai" ||
      target.pathname !== "/callback"
    ) {
      setError("This app is not approved for CreatorHive login.");
      return;
    }
    sessionStorage.removeItem("creatorhive.oauth.authorization");
    window.location.assign(url);
  }, []);
  useEffect(() => {
    let current = true;
    void supabase?.auth.oauth
      .getAuthorizationDetails(authorizationId)
      .then(({ data, error }) => {
        if (!current) return;
        if (error) setError(error.message);
        else if (data && "client" in data) setDetails(data);
        else if (data && "redirect_url" in data) returnToApp(data.redirect_url);
      });
    return () => {
      current = false;
    };
  }, [authorizationId, returnToApp]);
  async function consent(approved: boolean) {
    if (!supabase) return;
    setBusy(true);
    setError("");
    const { data, error } = approved
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        });
    if (error) setError(error.message);
    else if (data) returnToApp(data.redirect_url);
    setBusy(false);
  }
  const allowed =
    details?.redirect_uri === "https://sso-demo.creatorhive.ai/callback" &&
    details.scope
      .split(" ")
      .every((scope) => ["openid", "email", "profile"].includes(scope));
  return (
    <main className="hive-app hive-entry">
      <div className="w-full max-w-md">
        <h1>Sign in with CreatorHive</h1>
        {details ? (
          <>
            <h2 className="mt-4 text-xl">{details.client.name}</h2>
            <p className="mt-3">
              Share your basic profile, email, and CreatorHive community access
              with this app.
            </p>
            <p className="mt-2">Signed in as {details.user.email}</p>
            <div className="mt-5 flex gap-3">
              <button
                className="hive-primary-button"
                type="button"
                disabled={busy || !allowed}
                onClick={() => void consent(true)}
              >
                Allow access
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void consent(false)}
              >
                Cancel
              </button>
            </div>
            {!allowed && (
              <p role="alert">
                This app or its requested access is not approved.
              </p>
            )}
          </>
        ) : (
          !error && <p role="status">Loading app details…</p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </main>
  );
}
