/**
 * NIP-98 HTTP Auth helper — signs a kind:27235 event for authenticating
 * HTTP requests to the relay (used by isomorphic-git for smart HTTP transport).
 */

import { managedAccountsEnabled } from "./supabase";
import { loadIdentity } from "./identity";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { signNostrEvent } from "./nostr-signer";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build a NIP-98 Authorization header value.
 *
 * Signed POST bodies include the payload digest required by invite endpoints.
 */
export async function makeNip98AuthHeader(
  url: string,
  method: string,
  options?: {
    body?: string;
    payloadSha256?: string;
    requireNip07?: boolean;
    secretKey?: Uint8Array;
  },
): Promise<string> {
  const tags = [
    ["u", url],
    ["method", method],
  ];
  // Binary bodies hash themselves and pass the digest; string bodies hash here.
  const payload =
    options?.payloadSha256 ??
    (options?.body !== undefined ||
    (managedAccountsEnabled && ["POST", "PUT", "PATCH"].includes(method))
      ? await sha256Hex(options?.body ?? "")
      : undefined);
  if (payload !== undefined) {
    tags.push(["payload", payload]);
  }
  tags.push(["nonce", crypto.randomUUID()]);
  if (managedAccountsEnabled && options?.secretKey)
    throw new Error("Please use your CreatorHive account.");
  const unsigned = {
    kind: 27235,
    tags,
    content: "",
    created_at: Math.floor(Date.now() / 1000),
  };
  const account = loadIdentity();
  if (
    options?.secretKey &&
    account?.sessionToken &&
    account.pubkey === getPublicKey(options.secretKey)
  )
    unsigned.tags.push(["account-session", account.sessionToken]);
  const event = options?.secretKey
    ? finalizeEvent(unsigned, options.secretKey)
    : await signNostrEvent(unsigned, { requireNip07: options?.requireNip07 });

  const json = JSON.stringify(event);
  const base64 = btoa(json);
  return `Nostr ${base64}`;
}
