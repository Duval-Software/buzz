import { useState } from "react";
import { NotificationSettings } from "@/features/notifications/ui/NotificationSettings";
import { publishDisplayName } from "@/features/profile/profile-store";
import { useProfile } from "@/features/profile/use-profiles";
import { exportIdentity, type StoredIdentity } from "@/shared/lib/identity";

/**
 * Backup and sign-out.
 *
 * The uncomfortable truth this screen has to convey: a key in localStorage is
 * gone forever if the browser data is cleared, and there is no reset link,
 * because nobody is holding a copy. So the backup is offered plainly rather
 * than buried, and signing out says what it costs before it does it.
 *
 * The secret stays hidden until asked for. Someone screen-sharing a chat window
 * should not have their key on screen because they opened the wrong panel.
 */
export function IdentityPanel({
  identity,
  onClose,
  onSignOut,
}: {
  identity: StoredIdentity;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const profile = useProfile(identity.pubkey);
  const [nameDraft, setNameDraft] = useState(profile?.displayName ?? "");
  const [nameBusy, setNameBusy] = useState(false);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      {/* Capped and scrollable: with the notification section added this is
          taller than a phone screen. */}
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-5 text-neutral-200">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-semibold text-amber-400 text-lg">
            Your identity
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-500 text-sm"
          >
            Close
          </button>
        </div>

        <p className="mt-1 text-neutral-500 text-xs">
          This is who you are in the community. Share the public one freely.
        </p>

        <div className="mt-4">
          <span className="text-neutral-400 text-xs">Display name</span>
          <div className="mt-1 flex items-center gap-2">
            <input
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
                  setNameNote("Saved. Everyone sees this instead of your key.");
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
          <span className="font-medium text-amber-300 text-sm">Backup key</span>
          <p className="mt-1 text-neutral-400 text-xs">
            Anyone with this can post as you. Save it somewhere private. If you
            clear this browser's data without it, this identity is gone and
            cannot be recovered by anyone.
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

        <NotificationSettings />

        <div className="mt-5 border-neutral-800 border-t pt-4">
          {confirmingSignOut ? (
            <div className="flex flex-col gap-2">
              <p className="text-neutral-300 text-sm">
                Sign out and forget this key on this device? Without a backup
                you cannot get this identity back.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onSignOut}
                  className="rounded-lg bg-red-900 px-3 py-1.5 text-red-100 text-sm"
                >
                  Forget it
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
    </div>
  );
}
