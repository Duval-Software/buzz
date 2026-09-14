import { useState } from "react";

/** Shared accessible credentials form for entry and account settings. */
export function CredentialForm({
  mode,
  onSubmit,
  username,
}: {
  mode: "login" | "register" | "password";
  onSubmit: (
    username: string,
    password: string,
    newPassword: string,
  ) => Promise<void>;
  username?: string;
}) {
  const [name, setName] = useState(username ?? "");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="hive-credentials"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        setNote("");
        if (
          mode !== "login" &&
          confirmation !== (mode === "password" ? newPassword : password)
        ) {
          setError("Your passwords do not match.");
          return;
        }
        setBusy(true);
        try {
          await onSubmit(name, password, newPassword);
          setPassword("");
          setNewPassword("");
          setConfirmation("");
          setNote(
            mode === "password" ? "Password updated." : "You’re signed in.",
          );
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "Please try again.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Username
        <input
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={3}
          maxLength={32}
          pattern="[A-Za-z0-9_]{3,32}"
          value={name}
          readOnly={!!username}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        {mode === "password" ? "Current password" : "Password"}
        <input
          name="password"
          type="password"
          autoComplete={
            mode === "register" ? "new-password" : "current-password"
          }
          required
          minLength={mode === "register" ? 15 : 1}
          maxLength={256}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {mode === "password" && (
        <label>
          New password
          <input
            name="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={15}
            maxLength={256}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
      )}
      {mode !== "login" && (
        <>
          <label>
            Confirm password
            <input
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={15}
              maxLength={256}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <p className="hive-entry-note">
            Use at least 15 characters. A few memorable words work well. Save
            your login in a password manager.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="text-red-300 text-sm">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="text-amber-300 text-sm">
          {note}
        </p>
      )}
      <button type="submit" disabled={busy} className="hive-primary-button">
        {busy
          ? "Please wait…"
          : mode === "register"
            ? "Create account"
            : mode === "password"
              ? "Update password"
              : "Sign in"}
      </button>
    </form>
  );
}
