/**
 * The live half of the inbox, shaped around a relay constraint.
 *
 * Verified against production (2026-08-16): this relay's live fan-out only
 * matches subscriptions carrying a SINGLE `#h` value. A `#p` mention filter
 * is a community-global subscription, and channel events are never fanned
 * out globally (that isolation is a relay security invariant), so mentions
 * and DM messages posted while the app is open never reach the inbox's own
 * `#p` subscription; they used to appear only after a reload. Global events
 * (pulse notes) DO arrive live on `#p`, which is why the inbox keeps its
 * original subscription alongside this layer.
 *
 * So: resolve the channels this member belongs to from kind:39002 (a stored
 * `#p` query, which works fine), open one live subscription per channel with
 * a single `#h` value, and filter for the member's own mentions client-side.
 * The membership list re-resolves on an interval so channels joined
 * mid-session (a fresh DM, the greeter seating us somewhere new) start
 * listening without a reload.
 */

import { useEffect, useRef, useState } from "react";
import type { NostrEvent } from "@/shared/lib/nostr-client";
import { getSocket } from "@/shared/lib/nostr-socket";
import { relayWsUrl } from "@/shared/lib/relay-url";

const KIND_GROUP_MEMBERS = 39002;
/** Channel-scoped kinds that can address a person: chat, rich messages,
 * workflow approval requests. Pulse notes (kind 1) carry no `h` tag, so the
 * global `#p` subscription still delivers those live. */
const LIVE_MENTION_KINDS = [9, 40002, 46010];
const MEMBERSHIP_REFRESH_MS = 5 * 60 * 1000;

export function useLiveChannelMentions(
  selfPubkey: string,
  onMention: (event: NostrEvent) => void,
): void {
  const [channels, setChannels] = useState<string[]>([]);
  const handler = useRef(onMention);
  handler.current = onMention;

  // Which channels am I in? Stored #p queries work fine; only live delivery
  // is broken, so the list refreshes on an interval, not a subscription.
  useEffect(() => {
    if (!selfPubkey) {
      return;
    }
    const socket = getSocket(relayWsUrl());
    let cancelled = false;
    const resolve = async () => {
      const memberships = await socket.queryOnce([
        {
          kinds: [KIND_GROUP_MEMBERS],
          "#p": [selfPubkey.toLowerCase()],
          limit: 100,
        },
      ]);
      if (cancelled) {
        return;
      }
      const ids = [
        ...new Set(
          memberships
            .map((ev) => ev.tags.find((t) => t[0] === "d")?.[1])
            .filter((d): d is string => Boolean(d)),
        ),
      ].sort();
      setChannels((prev) => (prev.join() === ids.join() ? prev : ids));
    };
    void resolve();
    const timer = setInterval(() => void resolve(), MEMBERSHIP_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selfPubkey]);

  // One live subscription per channel: the only filter shape this relay fans
  // out to. `since` keeps the pre-EOSE replay to the last few seconds, and a
  // reconnect replays from the same marker, so mentions missed during a
  // network drop still arrive (callers dedupe by event id).
  useEffect(() => {
    if (!selfPubkey || channels.length === 0) {
      return;
    }
    const socket = getSocket(relayWsUrl());
    const me = selfPubkey.toLowerCase();
    const since = Math.floor(Date.now() / 1000) - 5;
    const unsubscribes = channels.map((channel) =>
      socket.subscribe(
        [{ kinds: LIVE_MENTION_KINDS, "#h": [channel], since }],
        {
          onEvent: (event) => {
            if (event.pubkey.toLowerCase() === me) {
              return;
            }
            const mentionsMe = event.tags.some(
              (t) => t[0] === "p" && t[1]?.toLowerCase() === me,
            );
            if (mentionsMe) {
              handler.current(event);
            }
          },
        },
      ),
    );
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [selfPubkey, channels]);
}
