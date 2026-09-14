/** Account sign-in and community admission are separate server decisions. */

import { logoutAccount } from "@/features/identity/accounts";
import { resetProfiles } from "@/features/profile/profile-store";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  createIdentity,
  forgetIdentity,
  importIdentity,
  loadIdentity,
  type StoredIdentity,
  subscribeIdentity,
} from "@/shared/lib/identity";
import { type AuthState, getSocket } from "@/shared/lib/nostr-socket";
import { relayWsUrl } from "@/shared/lib/relay-url";

export type MembershipStatus =
  /** No key on this device yet. */
  | "no-identity"
  /** We have a key; the relay has not given its verdict yet. */
  | "checking"
  /** The relay accepted this key. */
  | "member"
  /** The relay knows this key and refuses it. */
  | "not-member";

export function useMembership(): {
  identity: StoredIdentity | null;
  status: MembershipStatus;
  /** The relay's own words when it refuses, e.g. "restricted: not a relay member". */
  reason: string;
  /** Make a key on this device if there is not one, and return it. */
  ensureIdentity: () => StoredIdentity;
  /** Adopt an existing key. Returns false if the nsec is not valid. */
  adoptIdentity: (nsec: string) => boolean;
  /** Forget the key on this device and drop the connection. */
  signOut: () => Promise<void>;
  /** Re-authenticate — call after joining so the relay re-decides. */
  recheck: () => void;
} {
  // Read from the identity store, not component state. Two components call
  // this hook (the gate and the chat page), and with local state a sign-out in
  // one leaves the other still rendering as the old identity.
  const identity = useSyncExternalStore(
    subscribeIdentity,
    loadIdentity,
    () => null,
  );
  const [auth, setAuth] = useState<{ state: AuthState; reason: string }>(() =>
    getSocket(relayWsUrl()).getAuthState(),
  );

  // Only open a connection once there is a key to authenticate with. A visitor
  // with no key would otherwise be handed the ephemeral fallback identity and
  // refused, which is a confusing way to learn you have not joined yet.
  useEffect(() => {
    if (!identity) {
      return;
    }
    const socket = getSocket(relayWsUrl());
    setAuth(socket.getAuthState());
    const unsubscribe = socket.onAuthChange((state, reason) =>
      setAuth({ state, reason }),
    );
    socket.connect();
    return unsubscribe;
  }, [identity]);

  useEffect(() => {
    if (
      identity?.username &&
      auth.state === "denied" &&
      auth.reason.includes("Session expired")
    ) {
      getSocket(relayWsUrl()).close();
      resetProfiles();
      forgetIdentity();
    }
  }, [identity, auth]);

  const ensureIdentity = useCallback((): StoredIdentity => {
    return loadIdentity() ?? createIdentity();
  }, []);

  const adoptIdentity = useCallback((nsec: string): boolean => {
    if (!importIdentity(nsec)) {
      return false;
    }
    // The socket authenticated as somebody else. Start over as this key.
    getSocket(relayWsUrl()).reconnect();
    return true;
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await logoutAccount();
    getSocket(relayWsUrl()).close();
    resetProfiles();
    forgetIdentity();
    setAuth({ state: "unknown", reason: "" });
  }, []);

  const recheck = useCallback((): void => {
    getSocket(relayWsUrl()).reconnect();
  }, []);

  const status: MembershipStatus = !identity
    ? "no-identity"
    : auth.state === "accepted"
      ? "member"
      : auth.state === "denied"
        ? "not-member"
        : "checking";

  return {
    identity,
    status,
    reason: auth.reason,
    ensureIdentity,
    adoptIdentity,
    signOut,
    recheck,
  };
}
