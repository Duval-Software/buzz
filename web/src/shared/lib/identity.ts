/** Identity used by the messaging protocol. Credential accounts unlock it in memory.
 * Legacy browser identities remain available until their owner creates a login. */

import { nip19 } from "nostr-tools";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

const STORAGE_KEY = "buzz.identity.nsec";

export type StoredIdentity = {
  secretKey: Uint8Array;
  pubkey: string;
  npub: string;
  username?: string;
  sessionToken?: string;
};

/**
 * The current identity, cached.
 *
 * `undefined` means "not read yet"; `null` means "read, and there is none".
 * The cache exists so `getIdentity` can return a STABLE reference — a fresh
 * object per call would spin `useSyncExternalStore` forever.
 */
let cached: StoredIdentity | null | undefined;
const listeners = new Set<() => void>();

function decode(nsec: string): Uint8Array | null {
  try {
    const { type, data } = nip19.decode(nsec);
    return type === "nsec" ? (data as Uint8Array) : null;
  } catch {
    return null;
  }
}

function toIdentity(secretKey: Uint8Array): StoredIdentity {
  const pubkey = getPublicKey(secretKey);
  return { secretKey, pubkey, npub: nip19.npubEncode(pubkey) };
}

function readFromStorage(): StoredIdentity | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return null;
  }
  const secretKey = decode(stored);
  if (!secretKey) {
    // A corrupt value is worse than none: it would fail every signature with a
    // confusing error. Drop it and let the caller create a fresh identity.
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  return toIdentity(secretKey);
}

function publish(next: StoredIdentity | null): void {
  cached = next;
  for (const listener of listeners) {
    listener();
  }
}

/** The identity stored on this device, or null if there is not one yet. */
export function loadIdentity(): StoredIdentity | null {
  if (cached === undefined) {
    cached = readFromStorage();
  }
  return cached;
}

/** Subscribe to identity changes. Returns an unsubscribe function. */
export function subscribeIdentity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Another tab signing in or out changes who this browser is. Without this, two
// open tabs disagree about the current identity and one of them signs with a
// key that is no longer there.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      publish(readFromStorage());
    }
  });
}

/** Create and persist a new identity, replacing any existing one. */
export function createIdentity(): StoredIdentity {
  const secretKey = generateSecretKey();
  localStorage.setItem(STORAGE_KEY, nip19.nsecEncode(secretKey));
  const identity = toIdentity(secretKey);
  publish(identity);
  return identity;
}

/** Load the stored identity, creating one on first visit. */
export function loadOrCreateIdentity(): StoredIdentity {
  return loadIdentity() ?? createIdentity();
}

/** Adopt an identity the user already owns, from its `nsec`. */
export function importIdentity(nsec: string): StoredIdentity | null {
  const secretKey = decode(nsec.trim());
  if (!secretKey) {
    return null;
  }
  localStorage.setItem(STORAGE_KEY, nip19.nsecEncode(secretKey));
  const identity = toIdentity(secretKey);
  publish(identity);
  return identity;
}

/** The backup string to show a user who asks to save their identity. */
export function exportIdentity(): string | null {
  return typeof localStorage === "undefined"
    ? null
    : localStorage.getItem(STORAGE_KEY);
}

/** Unlock a credential account without persisting its secret or password. */
export function unlockAccount(
  secretKey: Uint8Array,
  username: string,
  sessionToken: string,
): StoredIdentity {
  const identity = { ...toIdentity(secretKey), username, sessionToken };
  // Remove a migrated legacy secret only after the server has saved the account.
  localStorage.removeItem(STORAGE_KEY);
  publish(identity);
  return identity;
}

export function forgetIdentity(): void {
  localStorage.removeItem(STORAGE_KEY);
  publish(null);
}
