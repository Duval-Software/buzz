/**
 * Reactions and typing indicators for the open channel.
 *
 * Both ride the same shared socket as messages. Reactions are stored events
 * (kind:7); typing is ephemeral (kind:20002, Redis pub/sub only), so it is
 * never persisted and expires on its own if a sender disappears.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KIND_DELETE,
  KIND_REACTION,
  KIND_TYPING,
  reactionTags,
  reactionTarget,
} from "@/features/chat/chat-events";
import type { NostrEvent } from "@/shared/lib/nostr-client";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { getSocket } from "@/shared/lib/nostr-socket";
import { relayWsUrl } from "@/shared/lib/relay-url";

export type ReactionSummary = {
  emoji: string;
  count: number;
  /** True when the signed-in member is one of the reactors. */
  mine: boolean;
  /** Our own reaction event, needed to retract it. */
  myEventId?: string;
};

/** emoji summaries per target message id. */
export type ReactionMap = Map<string, ReactionSummary[]>;

type ReactionRecord = {
  id: string;
  target: string;
  emoji: string;
  pubkey: string;
};

/** Typing indicators time out on their own; senders may never say "stopped". */
const TYPING_TTL_MS = 6_000;
const TYPING_REFRESH_MS = 3_000;

export function useReactions(
  channelId: string | null,
  myPubkey: string,
): {
  reactions: ReactionMap;
  toggle: (targetId: string, emoji: string) => Promise<void>;
} {
  const socket = useMemo(() => getSocket(relayWsUrl()), []);
  const [records, setRecords] = useState<ReactionRecord[]>([]);
  // Retracted ids, so a removed reaction disappears immediately rather than
  // waiting for the relay to stop serving it.
  const [retracted, setRetracted] = useState<Set<string>>(new Set());

  useEffect(() => {
    setRecords([]);
    setRetracted(new Set());
    if (!channelId) {
      return;
    }
    return socket.subscribe(
      [{ kinds: [KIND_REACTION], "#h": [channelId], limit: 500 }],
      {
        onEvent: (event: NostrEvent) => {
          const target = reactionTarget(event);
          if (!target || !event.content) {
            return;
          }
          setRecords((prev) =>
            prev.some((r) => r.id === event.id)
              ? prev
              : [
                  ...prev,
                  {
                    id: event.id,
                    target,
                    emoji: event.content,
                    pubkey: event.pubkey,
                  },
                ],
          );
        },
      },
    );
  }, [socket, channelId]);

  const reactions = useMemo(() => {
    const map: ReactionMap = new Map();
    for (const record of records) {
      if (retracted.has(record.id)) {
        continue;
      }
      const list = map.get(record.target) ?? [];
      const existing = list.find((s) => s.emoji === record.emoji);
      const isMine = record.pubkey === myPubkey;
      if (existing) {
        existing.count += 1;
        existing.mine = existing.mine || isMine;
        if (isMine) {
          existing.myEventId = record.id;
        }
      } else {
        list.push({
          emoji: record.emoji,
          count: 1,
          mine: isMine,
          myEventId: isMine ? record.id : undefined,
        });
      }
      map.set(record.target, list);
    }
    return map;
  }, [records, retracted, myPubkey]);

  const toggle = useCallback(
    async (targetId: string, emoji: string) => {
      if (!channelId) {
        return;
      }
      const mine = reactions
        .get(targetId)
        ?.find((s) => s.emoji === emoji && s.mine);

      if (mine?.myEventId) {
        // Retract: a kind:5 deletion naming our own reaction event.
        const signed = await signNostrEvent({
          kind: KIND_DELETE,
          tags: [["e", mine.myEventId]],
          content: "",
        });
        setRetracted((prev) => new Set(prev).add(mine.myEventId as string));
        await socket.publish(signed);
        return;
      }

      const signed = await signNostrEvent({
        kind: KIND_REACTION,
        tags: reactionTags(channelId, targetId),
        content: emoji,
      });
      setRecords((prev) => [
        ...prev,
        { id: signed.id, target: targetId, emoji, pubkey: signed.pubkey },
      ]);
      await socket.publish(signed);
    },
    [socket, channelId, reactions],
  );

  return { reactions, toggle };
}

/** Who is typing in this channel right now, excluding ourselves. */
export function useTyping(
  channelId: string | null,
  myPubkey: string,
): { typists: string[]; noteTyping: () => void } {
  const socket = useMemo(() => getSocket(relayWsUrl()), []);
  const [seen, setSeen] = useState<Map<string, number>>(new Map());
  const lastSent = useRef(0);

  useEffect(() => {
    setSeen(new Map());
    if (!channelId) {
      return;
    }
    return socket.subscribe([{ kinds: [KIND_TYPING], "#h": [channelId] }], {
      onEvent: (event: NostrEvent) => {
        if (event.pubkey === myPubkey) {
          return;
        }
        setSeen((prev) => new Map(prev).set(event.pubkey, Date.now()));
      },
    });
  }, [socket, channelId, myPubkey]);

  // Expire stale indicators on a timer rather than trusting a "stopped"
  // message that may never arrive.
  useEffect(() => {
    const timer = setInterval(() => {
      setSeen((prev) => {
        const now = Date.now();
        const next = new Map(prev);
        let changed = false;
        for (const [pubkey, at] of prev) {
          if (now - at > TYPING_TTL_MS) {
            next.delete(pubkey);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 2_000);
    return () => clearInterval(timer);
  }, []);

  const noteTyping = useCallback(() => {
    if (!channelId) {
      return;
    }
    // Throttle: one indicator every few seconds, not one per keystroke.
    const now = Date.now();
    if (now - lastSent.current < TYPING_REFRESH_MS) {
      return;
    }
    lastSent.current = now;
    void signNostrEvent({
      kind: KIND_TYPING,
      tags: [["h", channelId]],
      content: "",
    }).then((signed) => socket.publish(signed));
  }, [socket, channelId]);

  return { typists: [...seen.keys()], noteTyping };
}
