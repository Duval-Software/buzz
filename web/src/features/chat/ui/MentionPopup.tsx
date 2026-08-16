import { useSyncExternalStore } from "react";
import { AvatarDisc } from "@/features/profile/ui/AvatarDisc";
import {
  getProfilesSnapshot,
  subscribeProfiles,
} from "@/features/profile/profile-store";

export type MentionCandidate = { pubkey: string; name: string; bot: boolean };

/**
 * Who can be @mentioned: everyone with a named profile, agents included.
 *
 * Same population the DM picker offers, for the same reason — a `p` tag is
 * only useful if the name in the text resolves back to it on other screens,
 * and only profile-holders have names.
 */
export function useMentionCandidates(
  selfPubkey: string,
  query: string | null,
): MentionCandidate[] {
  const snapshot = useSyncExternalStore(
    subscribeProfiles,
    getProfilesSnapshot,
    getProfilesSnapshot,
  );
  if (query === null) {
    return [];
  }
  const needle = query.toLowerCase();
  return [...snapshot.profiles.entries()]
    .filter(([pk]) => pk !== selfPubkey.toLowerCase())
    .flatMap(([pk, profile]) =>
      profile.displayName
        ? [{ pubkey: pk, name: profile.displayName, bot: profile.bot }]
        : [],
    )
    .filter((person) => person.name.toLowerCase().startsWith(needle))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 6);
}

/** The floating list above the composer. Pure presentation. */
export function MentionPopup({
  candidates,
  selectedIndex,
  onPick,
}: {
  candidates: MentionCandidate[];
  selectedIndex: number;
  onPick: (candidate: MentionCandidate) => void;
}) {
  if (candidates.length === 0) {
    return null;
  }
  return (
    <div className="absolute bottom-full left-0 z-30 mb-1 w-64 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 shadow-xl">
      {candidates.map((candidate, index) => (
        <button
          key={candidate.pubkey}
          type="button"
          // Fires before the input's blur, unlike click.
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(candidate);
          }}
          className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${
            index === selectedIndex ? "bg-neutral-800" : "hover:bg-neutral-900"
          }`}
        >
          <AvatarDisc
            pubkey={candidate.pubkey}
            name={candidate.name}
            size={20}
          />
          <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
          {candidate.bot ? (
            <span className="shrink-0 rounded border border-neutral-700 px-1 text-neutral-500 text-xs">
              agent
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
