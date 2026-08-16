/**
 * Who people are, instead of hex.
 *
 * kind:0 is a replaceable event whose content is a JSON bag of profile fields.
 * On this relay the real population (checked before writing this) uses
 * `display_name` primarily, `name` as the older field, plus `about`,
 * `picture`, and a `bot` flag on the agents. Newest event per pubkey wins.
 *
 * One module-level store, read through useSyncExternalStore, for the same
 * reason identity works that way: half the app shows names, and per-component
 * state would mean as many subscriptions and as many chances to disagree.
 */

import type { NostrEvent } from "@/shared/lib/nostr-client";
import { getSocket } from "@/shared/lib/nostr-socket";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { truncatePubkey } from "@/shared/lib/pubkey";

export type Profile = {
  /** What to call them, already resolved by field priority. */
  displayName: string | null;
  about: string | null;
  /** True for the community's agents (their profiles carry bot: true). */
  bot: boolean;
  /** The full parsed content, kept so edits can preserve unknown fields. */
  raw: Record<string, unknown>;
  createdAt: number;
};

const profiles = new Map<string, Profile>();
const listeners = new Set<() => void>();
// useSyncExternalStore needs a snapshot that is reference-stable between
// changes; handing back the Map itself would re-render nothing (same ref) or,
// wrapped fresh each call, everything (new ref every render).
let snapshot: { profiles: Map<string, Profile> } = { profiles };
let started = false;

function emit(): void {
  snapshot = { profiles };
  for (const listener of listeners) {
    listener();
  }
}

function parseProfile(event: NostrEvent): Profile | null {
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(event.content);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    raw = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const displayName =
    typeof raw.display_name === "string" && raw.display_name.trim()
      ? raw.display_name.trim()
      : typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : null;
  return {
    displayName,
    about: typeof raw.about === "string" ? raw.about : null,
    bot: raw.bot === true,
    raw,
    createdAt: event.created_at,
  };
}

function ensureStarted(): void {
  if (started) {
    return;
  }
  started = true;
  // One live subscription for everyone's profiles. 500 covers this community
  // (16 members today) with two orders of magnitude of headroom; revisit
  // before it does not.
  getSocket(relayWsUrl()).subscribe([{ kinds: [0], limit: 500 }], {
    onEvent: (event) => {
      const pubkey = event.pubkey.toLowerCase();
      const next = parseProfile(event);
      if (!next) {
        return;
      }
      const prev = profiles.get(pubkey);
      // kind:0 is replaceable: the newest wins, and the relay may replay the
      // same latest event on resubscribe.
      if (prev && prev.createdAt >= next.createdAt) {
        return;
      }
      profiles.set(pubkey, next);
      emit();
    },
  });
}

export function subscribeProfiles(listener: () => void): () => void {
  ensureStarted();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getProfilesSnapshot(): { profiles: Map<string, Profile> } {
  return snapshot;
}

/** The name to show for a pubkey, falling back to the truncated npub. */
export function nameOf(pubkeyHex: string): string {
  return nameFromSnapshot(snapshot, pubkeyHex);
}

/**
 * Snapshot-explicit variant for React callers: taking the snapshot as an
 * argument lets a useCallback depend on it truthfully, so the resolver
 * invalidates exactly when a profile changes and the deps lint stays honest.
 */
export function nameFromSnapshot(
  snap: { profiles: Map<string, Profile> },
  pubkeyHex: string,
): string {
  const profile = snap.profiles.get(pubkeyHex.toLowerCase());
  return profile?.displayName ?? truncatePubkey(pubkeyHex);
}

/**
 * Publish the caller's display name.
 *
 * kind:0 REPLACES the whole profile, so this spreads the existing raw content
 * and overwrites only display_name. Publishing just {display_name} would
 * silently erase a picture or bot flag set from another client — the classic
 * replaceable-event foot-gun.
 */
export async function publishDisplayName(
  selfPubkey: string,
  displayName: string,
): Promise<void> {
  const existing = profiles.get(selfPubkey.toLowerCase());
  const content: Record<string, unknown> = {
    ...(existing?.raw ?? {}),
    display_name: displayName.trim(),
  };
  const event = await signNostrEvent({
    kind: 0,
    content: JSON.stringify(content),
    tags: [],
  });
  const result = await getSocket(relayWsUrl()).publish(event);
  if (!result.accepted) {
    throw new Error(result.reason || "the relay refused the profile");
  }
  // Reflect immediately rather than waiting to hear our own event back.
  const next = parseProfile(event);
  if (next) {
    profiles.set(selfPubkey.toLowerCase(), next);
    emit();
  }
}
