/**
 * Unread tracking.
 *
 * This is deliberately LOCAL for now: the last-read timestamp per channel is
 * kept in localStorage, so unread badges work immediately on this device.
 *
 * Buzz has a cross-device read-state kind (30078, parameterized replaceable,
 * NIP-44 encrypted to the user's own key). Syncing there is the correct end
 * state and is a follow-up: it needs encryption to self and careful
 * last-write-wins handling, and getting it half right would silently mark
 * things read on other devices. Local-first is honest and useful in the
 * meantime, and the storage shape below is what the synced version would
 * carry, so the upgrade is additive.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { KIND_CHAT } from "@/features/chat/chat-events";
import type { NostrEvent } from "@/shared/lib/nostr-client";
import { getSocket } from "@/shared/lib/nostr-socket";
import { relayWsUrl } from "@/shared/lib/relay-url";

const STORAGE_KEY = "buzz.readstate.v1";

type ReadState = Record<string, number>;

function loadReadState(): ReadState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ReadState) : {};
  } catch {
    return {};
  }
}

function saveReadState(state: ReadState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full or blocked storage is not worth breaking chat over.
  }
}

/**
 * Unread counts per channel, plus a way to mark one read.
 *
 * Watches every channel at once with a single subscription so a badge appears
 * for a channel the member is not currently looking at, which is the entire
 * point of an unread count.
 */
export function useUnread(
  channelIds: string[],
  activeChannelId: string | null,
  myPubkey: string,
): {
  unread: Map<string, number>;
  markRead: (channelId: string) => void;
} {
  const socket = useMemo(() => getSocket(relayWsUrl()), []);
  const [readState, setReadState] = useState<ReadState>(() => loadReadState());
  const [latest, setLatest] = useState<Map<string, number[]>>(new Map());

  const key = channelIds.join(",");

  useEffect(() => {
    // Derive the list from the stable key: `channelIds` is a fresh array on
    // every parent render, which would tear down and rebuild this
    // subscription constantly.
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) {
      return;
    }
    // One subscription across all channels; the `h` filter takes a list.
    return socket.subscribe([{ kinds: [KIND_CHAT], "#h": ids, limit: 300 }], {
      onEvent: (event: NostrEvent) => {
        // Our own messages are read by definition.
        if (event.pubkey === myPubkey) {
          return;
        }
        const channelId = event.tags.find((t) => t[0] === "h")?.[1];
        if (!channelId) {
          return;
        }
        setLatest((prev) => {
          const next = new Map(prev);
          const times = next.get(channelId) ?? [];
          if (!times.includes(event.created_at)) {
            next.set(channelId, [...times, event.created_at]);
          }
          return next;
        });
      },
    });
  }, [socket, key, myPubkey]);

  const markReadTo = useCallback((channelId: string, upTo: number) => {
    setReadState((prev) => {
      if ((prev[channelId] ?? 0) >= upTo) {
        return prev;
      }
      const next = { ...prev, [channelId]: upTo };
      saveReadState(next);
      return next;
    });
  }, []);

  const markRead = useCallback(
    (channelId: string) => markReadTo(channelId, Math.floor(Date.now() / 1000)),
    [markReadTo],
  );

  // The newest message we have actually seen in the open channel. Marking read
  // up to THIS, rather than to the wall clock, means a message that arrives
  // late (or from a machine with a skewed clock) cannot be marked read before
  // it is displayed.
  const activeNewest =
    activeChannelId != null
      ? Math.max(0, ...(latest.get(activeChannelId) ?? [0]))
      : 0;

  useEffect(() => {
    if (!activeChannelId) {
      return;
    }
    markReadTo(activeChannelId, activeNewest);
  }, [activeChannelId, activeNewest, markReadTo]);

  const unread = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [channelId, times] of latest) {
      if (channelId === activeChannelId) {
        counts.set(channelId, 0);
        continue;
      }
      const since = readState[channelId] ?? 0;
      counts.set(channelId, times.filter((t) => t > since).length);
    }
    return counts;
  }, [latest, readState, activeChannelId]);

  return { unread, markRead };
}
