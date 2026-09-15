import { useEffect, useState } from "react";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/shared/lib/supabase";
import {
  memberProfileRequest,
  type MemberProfile,
} from "@/features/onboarding/member-profile";
import { HiveBrand } from "@/features/surfaces/ui/SurfacesNav";
import { appealAction, readOwnModeration, type OwnModeration } from "./api";
import "./moderation.css";

/** Uses the account session, never community admission or a private signing key. */
export function AccountRestrictions({
  initial,
  onRetry,
}: {
  initial?: OwnModeration;
  onRetry?: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((_event, session) =>
      setAccountId(session?.user.id || ""),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  const query = useQuery({
    queryKey: ["own-moderation", relayWsUrl(), accountId],
    enabled: Boolean(accountId),
    queryFn: readOwnModeration,
    initialData: initial,
    refetchInterval: 15000,
    retry: false,
  });
  const [selected, setSelected] = useState("");
  const [explanation, setExplanation] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <main className="hive-app staff-account">
      <section>
        <HiveBrand />
        <h1>Your account</h1>
        {query.isError ? (
          <p role="alert">
            Could not load restrictions.{" "}
            <button type="button" onClick={() => void query.refetch()}>
              Retry
            </button>
          </p>
        ) : query.isPending || !accountId ? (
          <p role="status">Loading your account…</p>
        ) : (
          <>
            {query.data.banned && (
              <p>
                Your community access is restricted. You can review the reason
                and submit an appeal below.
              </p>
            )}
            {query.data.rename_required && (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (busy) return;
                  setBusy(true);
                  setError("");
                  try {
                    const profile: MemberProfile =
                      await memberProfileRequest("get");
                    await memberProfileRequest("save", username, {
                      ...profile,
                      username,
                    });
                    await query.refetch();
                    setNotice("Your new username is saved.");
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Could not change username.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h2>Choose a new username</h2>
                <label>
                  Username
                  <input
                    required
                    autoComplete="username"
                    pattern="[a-z][a-z0-9_]{2,23}"
                    minLength={3}
                    maxLength={24}
                    value={username}
                    onChange={(event) =>
                      setUsername(event.target.value.toLowerCase())
                    }
                  />
                </label>
                <button disabled={busy} type="submit">
                  {busy ? "Saving…" : "Save username"}
                </button>
              </form>
            )}
            {!query.data.banned && !query.data.rename_required && (
              <button
                type="button"
                onClick={() =>
                  onRetry ? onRetry() : window.location.assign("/chat")
                }
              >
                Continue to CreatorHive
              </button>
            )}
            <h2>Moderation history</h2>
            {query.data.items.length === 0 && (
              <p>No moderation actions on your account.</p>
            )}
            {query.data.items.map((item) => (
              <article key={item.id}>
                <h3>{item.action?.replace(/_/g, " ")}</h3>
                <p>{item.reason}</p>
                <time>
                  {item.created_at
                    ? new Date(item.created_at).toLocaleString()
                    : ""}
                </time>
                {item.appeal_status ? (
                  <p>
                    Appeal: {item.appeal_status}
                    {item.decision ? ` — ${item.decision}` : ""}
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setSelected(item.id || "");
                      setExplanation("");
                      setError("");
                    }}
                  >
                    Appeal this action
                  </button>
                )}
              </article>
            ))}
            {selected && (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (busy) return;
                  setBusy(true);
                  setError("");
                  try {
                    await appealAction(selected, explanation);
                    setSelected("");
                    setNotice("Your appeal was submitted for review.");
                    await query.refetch();
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Could not submit appeal.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  What should the reviewer know?
                  <textarea
                    required
                    minLength={10}
                    maxLength={2000}
                    value={explanation}
                    onChange={(event) => setExplanation(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={busy}>
                  {busy ? "Submitting…" : "Submit appeal"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setSelected("")}
                >
                  Cancel
                </button>
              </form>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <button
          type="button"
          onClick={async () => {
            await supabase?.auth.signOut({ scope: "local" });
            window.location.assign("/chat");
          }}
        >
          Sign out
        </button>
      </section>
    </main>
  );
}
