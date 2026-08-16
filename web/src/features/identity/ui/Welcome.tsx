import { useState } from "react";
import { joinAvailable } from "@/features/identity/join";
import type { MembershipStatus } from "@/features/identity/use-identity";

/**
 * The front door.
 *
 * One button. Pressing it creates a key in this browser and claims membership
 * with it — no extension, no password, nothing to copy or paste. Everything
 * else on this screen is for the smaller group who already have a key.
 *
 * The two states it can open in are deliberately worded differently. Someone
 * with no key is joining. Someone whose key the relay refused is NOT broken and
 * should not be told to start over; their key is fine, their membership is what
 * is missing.
 */
export function Welcome({
  status,
  reason,
  onJoin,
  onAdopt,
}: {
  status: Extract<MembershipStatus, "no-identity" | "not-member">;
  reason: string;
  /** Create the key if needed, claim membership, then re-authenticate. */
  onJoin: () => Promise<void>;
  onAdopt: (nsec: string) => boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [nsec, setNsec] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const available = joinAvailable();

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await onJoin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not join.");
    } finally {
      setBusy(false);
    }
  }

  function adopt() {
    setImportError(null);
    if (!onAdopt(nsec)) {
      setImportError("That does not look like an nsec key.");
      return;
    }
    setNsec("");
    setShowImport(false);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-950 p-6 text-neutral-200">
      <div className="w-full max-w-md">
        <h1 className="font-semibold text-2xl text-amber-400">
          {status === "no-identity" ? "Welcome to the Hive" : "One step left"}
        </h1>
        <p className="mt-2 text-neutral-400 text-sm">
          {status === "no-identity"
            ? "Chat, channels, and video in one place. No app to install and no password to remember."
            : "This browser has an identity, but it is not a member of this community yet."}
        </p>

        {available ? (
          <button
            type="button"
            onClick={join}
            disabled={busy}
            className="mt-6 w-full rounded-xl bg-amber-500 px-4 py-3 font-semibold text-neutral-950 disabled:opacity-60"
          >
            {busy
              ? "Setting you up…"
              : status === "no-identity"
                ? "Join the Hive"
                : "Join with this identity"}
          </button>
        ) : (
          <p className="mt-6 rounded-xl border border-neutral-800 p-3 text-neutral-400 text-sm">
            Self-serve join is not enabled on this deployment. Ask an organiser
            for an invite.
          </p>
        )}

        <p className="mt-3 text-neutral-500 text-xs">
          Your key is created in this browser and never leaves it. Back it up
          from Identity once you are in, or you will lose access if you clear
          this site's data.
        </p>

        {error ? (
          <p
            className="mt-4 rounded-lg border border-red-900 bg-red-950/50 p-3 text-red-300 text-sm"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {status === "not-member" && reason ? (
          <p className="mt-4 text-neutral-500 text-xs">
            The relay said: <span className="text-neutral-400">{reason}</span>
          </p>
        ) : null}

        <div className="mt-8 border-neutral-800 border-t pt-4">
          {showImport ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="nsec-import" className="text-neutral-400 text-sm">
                Paste the nsec you already have
              </label>
              <textarea
                id="nsec-import"
                value={nsec}
                onChange={(event) => setNsec(event.target.value)}
                rows={2}
                spellCheck={false}
                placeholder="nsec1…"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-2 font-mono text-sm"
              />
              {importError ? (
                <p className="text-red-400 text-sm" role="alert">
                  {importError}
                </p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={adopt}
                  className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm"
                >
                  Use this key
                </button>
                <button
                  type="button"
                  onClick={() => setShowImport(false)}
                  className="rounded-lg px-3 py-1.5 text-neutral-500 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="text-neutral-400 text-sm underline underline-offset-4"
            >
              I already have a Nostr key
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
