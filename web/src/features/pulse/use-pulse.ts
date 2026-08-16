/**
 * Pulse: the community's microblog.
 *
 * Notes are plain kind:1 events with NO channel scope — that absence is what
 * makes them community-wide. Replies point at their parent with
 * `["e", parent, "", "reply"]`, exactly the shape the desktop composer emits,
 * so threads line up across clients. Likes are kind:7 reactions on the note
 * and are retracted with kind:5, one target per deletion (relay rule).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mediaOf, type MessageMedia } from "@/features/chat/message-media";
import type { NostrEvent } from "@/shared/lib/nostr-client";
import { getSocket } from "@/shared/lib/nostr-socket";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { relayWsUrl } from "@/shared/lib/relay-url";

const KIND_NOTE = 1;
const KIND_REACTION = 7;
const KIND_DELETE = 5;
const FEED_LIMIT = 100;

export type PulseNote = {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  /** The note this replies to, when it is a reply. */
  replyTo: string | null;
  media: MessageMedia[];
  pending?: boolean;
  failed?: string;
};

export type NoteLikes = {
  count: number;
  mine: boolean;
  /** Our own like's event id, needed to retract it. */
  myLikeId: string | null;
};

function toNote(event: NostrEvent): PulseNote {
  const reply = event.tags.find(
    (t) => t[0] === "e" && (t[3] === "reply" || t.length === 2),
  );
  return {
    id: event.id,
    pubkey: event.pubkey.toLowerCase(),
    content: event.content,
    createdAt: event.created_at,
    replyTo: reply?.[1] ?? null,
    media: mediaOf(event),
  };
}

export function usePulse(selfPubkey: string): {
  notes: PulseNote[];
  loading: boolean;
  publish: (text: string, replyTo?: string) => Promise<void>;
  likesOf: (noteId: string) => NoteLikes;
  toggleLike: (noteId: string) => Promise<void>;
} {
  const socket = useMemo(() => getSocket(relayWsUrl()), []);
  const [notes, setNotes] = useState<PulseNote[]>([]);
  const [likes, setLikes] = useState<Map<string, NostrEvent[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const deleted = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribe = socket.subscribe(
      [{ kinds: [KIND_NOTE], limit: FEED_LIMIT }],
      {
        onEvent: (event) => {
          setNotes((prev) => {
            if (prev.some((n) => n.id === event.id && !n.pending)) {
              return prev;
            }
            const next = [
              ...prev.filter((n) => n.id !== event.id),
              toNote(event),
            ];
            next.sort((a, b) => b.createdAt - a.createdAt);
            return next;
          });
        },
        onEose: () => setLoading(false),
        onClosed: () => setLoading(false),
      },
    );
    return unsubscribe;
  }, [socket]);

  // Reactions and deletes, scoped to the events on screen. The relay refuses
  // to answer unscoped reaction queries (verified live), so the filter names
  // every note id plus every like id we know: the note ids find likes, the
  // like ids find retractions of those likes.
  const noteIdsJoined = useMemo(
    () =>
      notes
        .map((n) => n.id)
        .sort()
        .join(","),
    [notes],
  );
  const likeIdsJoined = useMemo(
    () =>
      [...likes.values()]
        .flat()
        .map((e) => e.id)
        .sort()
        .join(","),
    [likes],
  );
  useEffect(() => {
    const ids = [
      ...noteIdsJoined.split(","),
      ...likeIdsJoined.split(","),
    ].filter(Boolean);
    if (ids.length === 0) {
      return;
    }
    const unsubscribe = socket.subscribe(
      [{ kinds: [KIND_REACTION, KIND_DELETE], "#e": ids, limit: 500 }],
      {
        onEvent: (event) => {
          if (event.kind === KIND_DELETE) {
            for (const t of event.tags) {
              if (t[0] === "e" && typeof t[1] === "string") {
                deleted.current.add(t[1]);
              }
            }
            setLikes((prev) => {
              const next = new Map<string, NostrEvent[]>();
              for (const [target, events] of prev) {
                next.set(
                  target,
                  events.filter((e) => !deleted.current.has(e.id)),
                );
              }
              return next;
            });
            setNotes((prev) => prev.filter((n) => !deleted.current.has(n.id)));
            return;
          }
          const target = event.tags.find((t) => t[0] === "e")?.[1];
          if (!target || deleted.current.has(event.id)) {
            return;
          }
          setLikes((prev) => {
            const existing = prev.get(target) ?? [];
            if (existing.some((e) => e.id === event.id)) {
              return prev;
            }
            const next = new Map(prev);
            next.set(target, [...existing, event]);
            return next;
          });
        },
      },
    );
    return unsubscribe;
  }, [socket, noteIdsJoined, likeIdsJoined]);

  const publish = useCallback(
    async (text: string, replyTo?: string) => {
      const body = text.trim();
      if (!body) {
        return;
      }
      const tags: string[][] = [];
      if (replyTo) {
        tags.push(["e", replyTo, "", "reply"]);
      }
      const signed = await signNostrEvent({
        kind: KIND_NOTE,
        tags,
        content: body,
      });
      setNotes((prev) =>
        [...prev, { ...toNote(signed), pending: true }].sort(
          (a, b) => b.createdAt - a.createdAt,
        ),
      );
      const { accepted, reason } = await socket.publish(signed);
      setNotes((prev) =>
        prev.map((n) =>
          n.id === signed.id
            ? {
                ...n,
                pending: false,
                failed: accepted ? undefined : reason || "the relay refused it",
              }
            : n,
        ),
      );
    },
    [socket],
  );

  const likesOf = useCallback(
    (noteId: string): NoteLikes => {
      const events = likes.get(noteId) ?? [];
      const mine = events.find(
        (e) => e.pubkey.toLowerCase() === selfPubkey.toLowerCase(),
      );
      return {
        count: events.length,
        mine: Boolean(mine),
        myLikeId: mine?.id ?? null,
      };
    },
    [likes, selfPubkey],
  );

  const toggleLike = useCallback(
    async (noteId: string) => {
      const current = likesOf(noteId);
      if (current.mine && current.myLikeId) {
        const likeId = current.myLikeId;
        const signed = await signNostrEvent({
          kind: KIND_DELETE,
          tags: [["e", likeId]],
          content: "",
        });
        const { accepted } = await socket.publish(signed);
        if (accepted) {
          deleted.current.add(likeId);
          setLikes((prev) => {
            const next = new Map(prev);
            next.set(
              noteId,
              (prev.get(noteId) ?? []).filter((e) => e.id !== likeId),
            );
            return next;
          });
        }
        return;
      }
      // No `h` tag: pulse notes live outside channels, and so do their likes.
      const signed = await signNostrEvent({
        kind: KIND_REACTION,
        tags: [["e", noteId]],
        content: "+",
      });
      const { accepted } = await socket.publish(signed);
      if (accepted) {
        setLikes((prev) => {
          const existing = prev.get(noteId) ?? [];
          if (existing.some((e) => e.id === signed.id)) {
            return prev;
          }
          const next = new Map(prev);
          next.set(noteId, [...existing, signed]);
          return next;
        });
      }
    },
    [socket, likesOf],
  );

  return { notes, loading, publish, likesOf, toggleLike };
}
