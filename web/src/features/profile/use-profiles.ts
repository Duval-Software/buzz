/**
 * React bindings for the profile store.
 *
 * `useNames` returns a resolver rather than a Map so call sites read
 * `names(pubkey)` and never touch the store's internals; the resolver is
 * rebuilt only when a profile actually changes.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  getProfilesSnapshot,
  nameFromSnapshot,
  type Profile,
  subscribeProfiles,
} from "@/features/profile/profile-store";

export function useNames(): (pubkeyHex: string) => string {
  const snapshot = useSyncExternalStore(
    subscribeProfiles,
    getProfilesSnapshot,
    getProfilesSnapshot,
  );
  return useCallback(
    (pubkeyHex: string) => nameFromSnapshot(snapshot, pubkeyHex),
    [snapshot],
  );
}

export function useProfile(pubkeyHex: string): Profile | null {
  const snapshot = useSyncExternalStore(
    subscribeProfiles,
    getProfilesSnapshot,
    getProfilesSnapshot,
  );
  return snapshot.profiles.get(pubkeyHex.toLowerCase()) ?? null;
}
