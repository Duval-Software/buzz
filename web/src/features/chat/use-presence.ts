/**
 * Who is around right now.
 *
 * Presence is kind:20001, an ephemeral event the relay never stores: it is
 * fanned out to whoever is listening and then gone. That shape decides the
 * whole design — there is no history to read, so a client only knows about
 * people who have published since it connected, and everyone must keep saying
 * "still here" or they fade out.
 *
 * # The rule that matters
 *
 * **The subject of a presence event is always its author.** A `p` tag is NOT
 * trusted, because anyone can sign an event carrying somebody else's pubkey in
 * a tag, and trusting it would let one member mark another offline (or "online"
 * when they are not). The desktop client makes the same call for the same
 * reason. Only the relay-signed path may name a third party, and this is not
 * that path.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NostrEvent } from "@/shared/lib/nostr-client";
import { getSocket } from "@/shared/lib/nostr-socket";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { signNostrEvent } from "@/shared/lib/nostr-signer";

/** Ephemeral: user presence update. */
export const KIND_PRESENCE = 20001;

export type PresenceStatus = "online" | "away" | "offline";

/**
 * How often we re-announce, and how long someone else's announcement counts.
 *
 * The TTL is three heartbeats so a single dropped event, or one slow network
 * moment, does not blink somebody offline. These match the desktop client's
 * values; a client that heartbeats slower than the relay's TTL would appear to
 * flicker for everyone else.
 */
const HEARTBEAT_MS = 60_000;
const TTL_MS = 3 * HEARTBEAT_MS;

/**
 * Away means "not at the keyboard", not "looking at another tab".
 *
 * A browser cannot see OS-wide idle the way the desktop app can, so this is
 * in-app activity plus page visibility. Ten minutes matches the desktop.
 */
const IDLE_MS = 10 * 60_000;

type Seen = { status: PresenceStatus; at: number };

export function usePresence(selfPubkey: string): {
  /** Everyone currently known to be online or away. */
  statuses: Map<string, PresenceStatus>;
  /** How many people are online right now, counting yourself. */
  onlineCount: number;
  statusOf: (pubkey: string) => PresenceStatus;
} {
  const socket = useMemo(() => getSocket(relayWsUrl()), []);
  const [seen, setSeen] = useState<Map<string, Seen>>(new Map());
  const lastActivity = useRef(Date.now());

  // Any real interaction counts as being at the keyboard.
  useEffect(() => {
    const touch = () => {
      lastActivity.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "visibilitychange"] as const;
    for (const name of events) {
      window.addEventListener(name, touch, { passive: true });
    }
    return () => {
      for (const name of events) {
        window.removeEventListener(name, touch);
      }
    };
  }, []);

  // Listen for everyone else.
  useEffect(() => {
    const unsubscribe = socket.subscribe([{ kinds: [KIND_PRESENCE] }], {
      onEvent: (event: NostrEvent) => {
        const status = event.content;
        if (status !== "online" && status !== "away" && status !== "offline") {
          return;
        }
        // The author IS the subject. Never read a p tag here.
        const pubkey = event.pubkey.toLowerCase();
        setSeen((prev) => {
          const next = new Map(prev);
          if (status === "offline") {
            next.delete(pubkey);
          } else {
            next.set(pubkey, { status, at: Date.now() });
          }
          return next;
        });
      },
    });
    return unsubscribe;
  }, [socket]);

  // Announce ourselves, and say goodbye on the way out.
  useEffect(() => {
    if (!selfPubkey) {
      return;
    }
    let stopped = false;

    async function announce(status: PresenceStatus) {
      try {
        const event = await signNostrEvent({
          kind: KIND_PRESENCE,
          content: status,
          tags: [],
        });
        await socket.publish(event);
      } catch {
        // Presence is a nicety. A failed heartbeat must never surface as an
        // error in a chat window; the worst case is fading out of the list.
      }
    }

    function currentStatus(): PresenceStatus {
      const idle = Date.now() - lastActivity.current >= IDLE_MS;
      return idle || document.visibilityState === "hidden" ? "away" : "online";
    }

    void announce(currentStatus());
    const timer = setInterval(() => {
      if (!stopped) {
        void announce(currentStatus());
      }
    }, HEARTBEAT_MS);

    // A clean goodbye removes the dot immediately instead of leaving a ghost
    // online for a TTL. Best effort: a closing tab may not get to send it,
    // which is exactly what the TTL is there to clean up.
    const farewell = () => {
      void announce("offline");
    };
    window.addEventListener("pagehide", farewell);

    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("pagehide", farewell);
      farewell();
    };
  }, [socket, selfPubkey]);

  // Expire stale entries on a timer rather than only on render: nobody
  // publishing means no re-render, and the list would stay stale forever.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const statuses = useMemo(() => {
    const now = Date.now();
    const out = new Map<string, PresenceStatus>();
    for (const [pubkey, entry] of seen) {
      if (now - entry.at <= TTL_MS) {
        out.set(pubkey, entry.status);
      }
    }
    // We know our own state without waiting to hear our own heartbeat back.
    if (selfPubkey) {
      out.set(selfPubkey.toLowerCase(), "online");
    }
    return out;
    // forceTick is intentionally in the dependency list: it is what re-runs
    // the expiry sweep on a quiet relay.
  }, [seen, selfPubkey]);

  const statusOf = useCallback(
    (pubkey: string): PresenceStatus =>
      statuses.get(pubkey.toLowerCase()) ?? "offline",
    [statuses],
  );

  const onlineCount = useMemo(
    () => [...statuses.values()].filter((s) => s === "online").length,
    [statuses],
  );

  return { statuses, onlineCount, statusOf };
}
