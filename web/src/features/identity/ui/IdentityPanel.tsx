import { ProfileEditButton } from "@/features/profile/ui/ProfileEditButton";
import { ConnectedApps } from "./ConnectedApps";
import { UserRound } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { CredentialForm } from "./CredentialForm";
import {
  changeAccountPassword,
  registerAccount,
} from "@/features/identity/accounts";
import { CommunityDialog } from "@/features/surfaces/ui/CommunityDialog";
import { useState } from "react";
import { NotificationSettings } from "@/features/notifications/ui/NotificationSettings";
import { publishDisplayName } from "@/features/profile/profile-store";
import { useProfile } from "@/features/profile/use-profiles";
import { exportIdentity, type StoredIdentity } from "@/shared/lib/identity";

/** Profile, credentials and legacy migration without changing membership. */
export function IdentityPanel({
  identity,
  onClose,
  onSignOut,
}: {
  identity: StoredIdentity;
  onClose: () => void;
  onSignOut: () => Promise<void>;
}) {
  const profile = useProfile(identity.pubkey);
  const [nameDraft, setNameDraft] = useState(profile?.displayName ?? "");
  const [nameBusy, setNameBusy] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [nameNote, setNameNote] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<"npub" | "nsec" | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const nsec = revealed ? exportIdentity() : null;

  async function copy(value: string, which: "npub" | "nsec") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard access can be refused; the value is on screen to copy by hand.
    }
  }

  return (
    <CommunityDialog
      label="Your account"
      description="Your profile, notifications, and access."
      icon={UserRound}
      busy={nameBusy || accessBusy}
      onClose={onClose}
    >
      <div className="hive-identity">
        <div className="hive-profile-intro">
          {identity.managed && (
            <ProfileEditButton className="block text-amber-400 underline">
              Edit public profile
            </ProfileEditButton>
          )}
          <Link
            to="/community"
            onClick={onClose}
            className="mt-2 inline-block text-amber-400 underline underline-offset-4"
          >
            Community settings
          </Link>
        </div>

        <div className="mt-4">
          <label
            htmlFor="profile-display-name"
            className="text-neutral-400 text-xs"
          >
            Display name
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="profile-display-name"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              maxLength={60}
              placeholder="How the hive sees you"
              className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-600"
            />
            <button
              type="button"
              disabled={nameBusy || nameDraft.trim().length === 0}
              onClick={async () => {
                setNameBusy(true);
                setNameNote(null);
                try {
                  await publishDisplayName(identity.pubkey, nameDraft);
                  setNameNote("Saved. Everyone sees your updated name.");
                } catch (cause) {
                  setNameNote(
                    cause instanceof Error ? cause.message : "could not save",
                  );
                } finally {
                  setNameBusy(false);
                }
              }}
              className="shrink-0 rounded-lg border border-neutral-700 px-2 py-1.5 text-neutral-300 text-xs disabled:opacity-50"
            >
              {nameBusy ? "…" : "Save"}
            </button>
          </div>
          {nameNote ? (
            <p className="mt-1 text-neutral-500 text-xs">{nameNote}</p>
          ) : null}
        </div>

        {identity.managed ? (
          <section className="mt-5">
            <h3 className="font-semibold">
              {identity.email ?? "Your CreatorHive account"}
            </h3>
            <p className="mt-2 text-neutral-400 text-sm">
              Sign in with Google or email and password.
            </p>
            <a href="/account-moderation">Account restrictions and appeals</a>
            <ConnectedApps />
          </section>
        ) : (
          <section className="mt-5">
            <h3 className="font-semibold">
              {identity.username
                ? `Signed in as @${identity.username}`
                : "Give your profile a login"}
            </h3>
            <p className="hive-entry-note">
              {identity.username
                ? "Use your username and password on another device. Your community access stays the same."
                : "Create a username and password for this profile. Your messages, memberships and roles stay with you."}
            </p>
            <details className="mt-3" open={!identity.username}>
              <summary>
                {identity.username ? "Change password" : "Create your login"}
              </summary>
              <CredentialForm
                key={identity.username ?? "migrate"}
                mode={identity.username ? "password" : "register"}
                username={identity.username}
                onSubmit={async (name, password, newPassword) => {
                  setAccessBusy(true);
                  try {
                    if (identity.username)
                      await changeAccountPassword(password, newPassword);
                    else await registerAccount(name, password);
                  } finally {
                    setAccessBusy(false);
                  }
                }}
              />
            </details>
          </section>
        )}
        {!identity.managed && !identity.username && (
          <details className="mt-5">
            <summary>Legacy account backup</summary>
            <div className="mt-4">
              <span className="text-neutral-400 text-xs">Public key</span>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs">
                  {identity.npub}
                </code>
                <button
                  type="button"
                  onClick={() => copy(identity.npub, "npub")}
                  className="rounded-lg border border-neutral-700 px-2 py-1.5 text-xs"
                >
                  {copied === "npub" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-amber-900/60 bg-amber-950/20 p-3">
              <span className="font-medium text-amber-300 text-sm">
                Backup key
              </span>
              <p className="mt-1 text-neutral-400 text-xs">
                Anyone with this can post as you. Save it somewhere private. If
                you clear this browser's data without it, this identity is gone
                and cannot be recovered by anyone.
              </p>
              {revealed && nsec ? (
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs">
                    {nsec}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(nsec, "nsec")}
                    className="rounded-lg border border-neutral-700 px-2 py-1.5 text-xs"
                  >
                    {copied === "nsec" ? "Copied" : "Copy"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setRevealed(true)}
                  className="mt-2 rounded-lg border border-amber-700 px-3 py-1.5 text-amber-300 text-sm"
                >
                  Show my backup key
                </button>
              )}
            </div>
          </details>
        )}

        <div className="mt-5">
          <Link
            to="/onboarding"
            onClick={onClose}
            className="text-amber-300 underline underline-offset-4"
          >
            Revisit the community welcome
          </Link>
        </div>

        <NotificationSettings />

        <div className="mt-5 border-neutral-800 border-t pt-4">
          {confirmingSignOut ? (
            <div className="flex flex-col gap-2">
              <p className="text-neutral-300 text-sm">
                {identity.managed
                  ? "Sign out of this browser? You can sign back in with your CreatorHive account."
                  : identity.username
                    ? "Sign out of this browser? You can sign back in with your username and password."
                    : "Create a login or save your legacy backup before signing out, so you can return to this profile."}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await onSignOut();
                    } catch (cause) {
                      setNameNote(
                        cause instanceof Error
                          ? cause.message
                          : "Could not sign out.",
                      );
                    }
                  }}
                  className="rounded-lg bg-red-900 px-3 py-1.5 text-red-100 text-sm"
                >
                  Sign out
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingSignOut(false)}
                  className="rounded-lg px-3 py-1.5 text-neutral-400 text-sm"
                >
                  Keep me signed in
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingSignOut(true)}
              className="text-neutral-400 text-sm underline underline-offset-4"
            >
              Sign out of this browser
            </button>
          )}
        </div>
      </div>
    </CommunityDialog>
  );
}
