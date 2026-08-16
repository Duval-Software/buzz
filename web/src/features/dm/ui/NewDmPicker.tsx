import { useState, useSyncExternalStore } from "react";
import { openDm } from "@/features/dm/open-dm";
import { AvatarDisc } from "@/features/profile/ui/AvatarDisc";
import {
  getProfilesSnapshot,
  subscribeProfiles,
} from "@/features/profile/profile-store";

/**
 * Starting a conversation.
 *
 * The list is everyone with a profile, which today is the population worth
 * DMing: named members and the agents. Members who never set a profile are
 * reachable the moment they do — and the community greeter nudges everyone to.
 * Agents are listed too, marked as such; talking to an agent in a DM is a
 * feature, not an accident.
 */
export function NewDmPicker({
  selfPubkey,
  onOpened,
  onClose,
}: {
  selfPubkey: string;
  onOpened: (channelId: string) => void;
  onClose: () => void;
}) {
  const snapshot = useSyncExternalStore(
    subscribeProfiles,
    getProfilesSnapshot,
    getProfilesSnapshot,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const people = [...snapshot.profiles.entries()]
    .filter(([pk]) => pk !== selfPubkey.toLowerCase())
    .map(([pk, profile]) => ({
      pubkey: pk,
      name: profile.displayName ?? pk,
      bot: profile.bot,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  async function start(pubkey: string) {
    setBusy(pubkey);
    setError(null);
    try {
      const channelId = await openDm([pubkey]);
      onOpened(channelId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "could not open");
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[10vh]">
      <div className="flex max-h-[70dvh] w-full max-w-md flex-col rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
        <div className="flex items-center justify-between border-neutral-800 border-b p-3">
          <h2 className="font-semibold text-sm">New message</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-700 px-2.5 py-1.5 text-neutral-400 text-sm"
          >
            Close
          </button>
        </div>
        {error ? (
          <p className="px-3 pt-2 text-red-400 text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex-1 overflow-y-auto p-2">
          {people.length === 0 ? (
            <p className="px-2 py-4 text-neutral-500 text-sm">
              Nobody here has set a profile yet.
            </p>
          ) : (
            people.map((person) => (
              <button
                key={person.pubkey}
                type="button"
                disabled={busy !== null}
                onClick={() => start(person.pubkey)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-neutral-900 disabled:opacity-50"
              >
                <AvatarDisc pubkey={person.pubkey} name={person.name} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {person.name}
                </span>
                {person.bot ? (
                  <span className="shrink-0 rounded border border-neutral-700 px-1 text-neutral-500 text-xs">
                    agent
                  </span>
                ) : null}
                {busy === person.pubkey ? (
                  <span className="shrink-0 text-neutral-500 text-xs">…</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
