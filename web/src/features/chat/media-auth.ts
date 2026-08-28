/**
 * Authenticated media fetching.
 *
 * The relay requires Blossom auth on every media READ (kind 24242 in an
 * Authorization header, membership-gated server-side). Plain <img>/<video>/
 * <audio> tags cannot send headers, so media is fetched with `fetch()` via
 * our same-origin `/media/*` proxy and handed to the element as an object
 * URL. Auth is server-scoped: one signed event covers every blob on the
 * relay for an hour, so rendering a timeline costs one signature, not one
 * per attachment.
 *
 * Object URLs are cached per path for the session. Media is immutable
 * (sha-addressed), so there is nothing to invalidate.
 */

import { useEffect, useState } from "react";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";
import { signNostrEvent } from "@/shared/lib/nostr-signer";

const KIND_BLOSSOM_AUTH = 24242;
const AUTH_TTL_SECONDS = 3600;

let cachedAuth: Promise<string> | null = null;
let authExpiresAt = 0;

function mediaAuthHeader(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // Refresh well before expiry so an in-flight fetch never carries a stale one.
  if (!cachedAuth || now > authExpiresAt - 300) {
    const expiration = now + AUTH_TTL_SECONDS;
    authExpiresAt = expiration;
    cachedAuth = (async () => {
      const relayHost = new URL(relayHttpBaseUrl()).host;
      const signed = await signNostrEvent({
        kind: KIND_BLOSSOM_AUTH,
        content: "Get media",
        tags: [
          ["t", "get"],
          ["server", relayHost],
          ["expiration", String(expiration)],
        ],
      });
      return `Nostr ${btoa(JSON.stringify(signed))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "")}`;
    })();
    cachedAuth.catch(() => {
      cachedAuth = null;
    });
  }
  return cachedAuth;
}

const objectUrls = new Map<string, Promise<string>>();

/**
 * Resolve a relay media URL to a playable/renderable object URL.
 * Callers must have vetted the URL with `isRelayMediaUrl` already.
 */
export function fetchAuthedMedia(url: string): Promise<string> {
  const path = new URL(url).pathname;
  let pending = objectUrls.get(path);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(path, {
        headers: { Authorization: await mediaAuthHeader() },
      });
      if (!response.ok) {
        throw new Error(`media fetch failed (${response.status})`);
      }
      return URL.createObjectURL(await response.blob());
    })();
    pending.catch(() => {
      objectUrls.delete(path);
    });
    objectUrls.set(path, pending);
  }
  return pending;
}

/** The object URL for a relay media URL, or null while it loads or on error. */
export function useAuthedMediaUrl(url: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    fetchAuthedMedia(url)
      .then((objectUrl) => {
        if (alive) {
          setSrc(objectUrl);
        }
      })
      .catch(() => {
        // The element simply never gets a src; the card shows its shell.
      });
    return () => {
      alive = false;
    };
  }, [url]);
  return src;
}
