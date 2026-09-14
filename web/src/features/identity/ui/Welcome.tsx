import { useState } from "react";
import { HiveBrand } from "@/features/surfaces/ui/SurfacesNav";
import { CredentialForm } from "./CredentialForm";
import { joinAvailable } from "@/features/identity/join";

/** The community front door: credentials first; existing accounts retain their membership. */
export function Welcome({
  hasIdentity,
  onAuthenticate,
  onJoin,
  onSignOut,
}: {
  hasIdentity: boolean;
  onAuthenticate: (
    mode: "login" | "register",
    username: string,
    password: string,
  ) => Promise<void>;
  onJoin: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="hive-app hive-entry">
      <div>
        <HiveBrand />
        <p className="hive-entry-kicker">
          Your people. Your projects. Your community.
        </p>
        <h1 className="font-semibold text-2xl text-amber-400">
          {hasIdentity
            ? "Join the conversation"
            : mode === "login"
              ? "Welcome back to the Hive"
              : "Find your people. Build together."}
        </h1>
        <p className="mt-2 text-neutral-400 text-sm">
          {hasIdentity
            ? "You’re signed in. Community access is a separate step."
            : "Watch the studio, share your work, and help shape what we build next."}
        </p>
        {hasIdentity ? (
          <div className="hive-credentials">
            <p>
              {joinAvailable()
                ? "Join CreatorHive to take part in the community."
                : "Ask a community organiser for an invitation."}
            </p>
            {joinAvailable() && (
              <button
                className="hive-primary-button"
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await onJoin();
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Could not join.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Joining…" : "Join CreatorHive"}
              </button>
            )}
            {error && (
              <p role="alert" className="text-red-300">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={async () => {
                try {
                  await onSignOut();
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Could not sign out.",
                  );
                }
              }}
            >
              Sign in to a different account
            </button>
          </div>
        ) : (
          <>
            <CredentialForm
              key={mode}
              mode={mode}
              onSubmit={(name, password) =>
                onAuthenticate(mode, name, password)
              }
            />
            <button
              className="hive-entry-switch"
              type="button"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login"
                ? "New here? Create an account"
                : "Already a member? Sign in"}
            </button>
            <p className="hive-entry-note">
              Your username and password work across devices. Community
              membership and permissions stay with your account.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
