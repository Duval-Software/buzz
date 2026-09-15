import { AccountRestrictions } from "@/features/moderation/AccountRestrictions";
import type { OwnModeration } from "@/features/moderation/api";
import { CreatorHiveConsent } from "./ConnectedApps";
import { useEffect, useState, type ReactNode } from "react";
import { supabase, managedAccountsEnabled } from "@/shared/lib/supabase";
import { forgetIdentity } from "@/shared/lib/identity";
import { getSocket } from "@/shared/lib/nostr-socket";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { bootstrapManagedAccount } from "../managed-accounts";
import { HiveBrand } from "@/features/surfaces/ui/SurfacesNav";
import type { Session } from "@supabase/supabase-js";
import { LoaderCircle } from "lucide-react";
import { SignInPage } from "@/shared/ui/sign-in";
import { HiveLoading } from "@/shared/ui/HiveLoading";

export function ManagedAuthGate({ children }: { children: ReactNode }) {
  if (!managedAccountsEnabled) return children;
  return <ManagedAccountSession>{children}</ManagedAccountSession>;
}

function ManagedAccountSession({ children }: { children: ReactNode }) {
  const [restriction, setRestriction] = useState<OwnModeration | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    return query.has("error") || hash.has("error")
      ? "Google sign-in wasn’t completed. Please try again."
      : "";
  });
  const [retry, setRetry] = useState(0);
  const [recovery, setRecovery] = useState(
    new URLSearchParams(window.location.search).get("account") === "recovery",
  );
  useEffect(() => {
    const client = supabase;
    if (!client) {
      setError("Account service is not configured.");
      setLoading(false);
      return;
    }
    let generation = retry;
    let disposed = false;
    const accept = async (session: Session | null) => {
      const current = ++generation;
      const stillCurrent = () => !disposed && current === generation;
      if (!session) {
        getSocket(relayWsUrl()).close();
        forgetIdentity();
        setReady(false);
        setRestriction(null);
        setLoading(false);
        return;
      }
      setError("");
      try {
        const own = await bootstrapManagedAccount(session, stillCurrent);
        if (!stillCurrent()) return;
        if (own && (own.banned || own.rename_required)) {
          getSocket(relayWsUrl()).close();
          forgetIdentity();
          setReady(false);
          setRestriction(own);
          return;
        }
        setRestriction(null);
        if (stillCurrent()) setReady(true);
      } catch (cause) {
        if (stillCurrent()) {
          getSocket(relayWsUrl()).close();
          forgetIdentity();
          setReady(false);
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not connect. Please retry.",
          );
        }
      } finally {
        if (stillCurrent()) setLoading(false);
      }
    };
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      // Keep Supabase's auth callback synchronous; network work runs outside its lock.
      if (event !== "USER_UPDATED")
        queueMicrotask(() => {
          if (!disposed) void accept(session);
        });
    });
    return () => {
      disposed = true;
      generation++;
      data.subscription.unsubscribe();
    };
  }, [retry]);
  const [authorizationId] = useState(() => {
    const incoming = new URLSearchParams(window.location.search).get(
      "authorization_id",
    );
    if (incoming)
      sessionStorage.setItem("creatorhive.oauth.authorization", incoming);
    return (
      incoming ?? sessionStorage.getItem("creatorhive.oauth.authorization")
    );
  });
  if (restriction && !recovery)
    return (
      <AccountRestrictions
        initial={restriction}
        onRetry={() => {
          setLoading(true);
          setRetry((n) => n + 1);
        }}
      />
    );
  if (ready && !recovery)
    return authorizationId ? (
      <CreatorHiveConsent authorizationId={authorizationId} />
    ) : (
      children
    );
  if (loading) return <HiveLoading message="Getting your account ready…" />;
  return (
    <SignInPage
      brand={<HiveBrand />}
      title="Welcome to CreatorHive"
      description="Sign in and make yourself at home."
      heroImageSrc="/creatorhive-workshop.png"
    >
      {error && (
        <div className="hive-account-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setRetry((n) => n + 1);
            }}
          >
            Retry connection
          </button>
        </div>
      )}
      <EmailSignIn
        recovery={recovery}
        onRecovered={() => {
          window.history.replaceState(null, "", "/chat");
          setRecovery(false);
          setRetry((n) => n + 1);
        }}
      />
      {!recovery && (
        <>
          <div className="hive-sign-in-divider">
            <span>or</span>
          </div>
          <GoogleSignIn />
        </>
      )}
    </SignInPage>
  );
}

function GoogleSignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn() {
    if (busy || !supabase) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/chat` },
      });
      if (error) throw error;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not open Google. Please try again.",
      );
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="hive-google-button"
        disabled={busy || !supabase}
        onClick={() => void signIn()}
      >
        {busy ? (
          <LoaderCircle className="hive-account-spinner" aria-hidden="true" />
        ) : (
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.02 46.98 31.87 46.98 24.55z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
        )}
        {busy ? "Opening Google…" : "Continue with Google"}
      </button>
      {busy && (
        <p className="hive-login-note" role="status">
          Taking you to Google to sign in securely.
        </p>
      )}
      {error && (
        <p className="hive-account-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function EmailSignIn({
  recovery,
  onRecovered,
}: {
  recovery: boolean;
  onRecovered: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  function changeMode(next: typeof mode) {
    setMode(next);
    setPassword("");
    setError("");
    setNote("");
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !supabase) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      if (recovery) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPassword("");
        onRecovered();
      } else if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      } else if (mode === "register") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/chat` },
        });
        if (error) throw error;
        setPassword("");
        setNote(
          "Check your email to confirm your account, then come back to sign in.",
        );
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          {
            redirectTo: `${window.location.origin}/chat?account=recovery`,
          },
        );
        if (error) throw error;
        setNote(
          "If an account uses that email, a recovery link is on its way.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not complete that request. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="hive-email-access">
      {(recovery || mode !== "login") && (
        <h2>
          {recovery
            ? "Choose a new password"
            : mode === "register"
              ? "Create your account"
              : "Reset your password"}
        </h2>
      )}
      <form
        className="hive-credentials"
        onSubmit={(event) => void submit(event)}
      >
        {!recovery && (
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              maxLength={254}
              disabled={busy}
              placeholder="you@example.com"
            />
          </label>
        )}
        {(recovery || mode !== "reset") && (
          <label>
            {recovery ? "New password" : "Password"}
            <input
              type="password"
              autoComplete={
                mode === "login" && !recovery
                  ? "current-password"
                  : "new-password"
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={mode === "login" && !recovery ? 1 : 15}
              maxLength={256}
              disabled={busy}
              aria-describedby={
                mode === "register" || recovery
                  ? "password-guidance"
                  : undefined
              }
            />
          </label>
        )}
        {(mode === "register" || recovery) && (
          <p id="password-guidance" className="hive-login-note">
            Use at least 15 characters. A few memorable words work well.
          </p>
        )}
        {!recovery && mode === "login" && (
          <button
            type="button"
            className="hive-email-reset"
            disabled={busy}
            onClick={() => changeMode("reset")}
          >
            Forgot password?
          </button>
        )}
        <button
          className="hive-primary-button"
          type="submit"
          disabled={busy || !supabase}
        >
          {busy
            ? "Please wait…"
            : recovery
              ? "Save password"
              : mode === "login"
                ? "Sign in"
                : mode === "register"
                  ? "Create account"
                  : "Send recovery email"}
        </button>
        {error && (
          <p className="hive-account-error" role="alert">
            {error}
          </p>
        )}
        {note && (
          <p className="hive-login-note" role="status">
            {note}
          </p>
        )}
      </form>
      {!recovery && (
        <p className="hive-email-switch">
          {mode === "login" ? "New to CreatorHive? " : "Already a member? "}
          <button
            type="button"
            disabled={busy}
            onClick={() => changeMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Create an account" : "Back to sign in"}
          </button>
        </p>
      )}
    </div>
  );
}
