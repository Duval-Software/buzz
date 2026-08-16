/**
 * The inbox: everything addressed to YOU, across the whole community.
 *
 * Two streams, the same shapes the desktop's home feed queries:
 *
 * - Mentions: kinds 9 (chat), 1 (pulse notes), 40002 (rich messages) carrying
 *   a `p` tag with your key. DM messages arrive here too, because DM
 *   recipients are `p`-tagged by every conforming client.
 * - Needs action: workflow approval requests (kind:46010) addressed to you,
 *   resolved by later grants (46011) and denials (46012) so acted-on requests
 *   stop asking.
 *
 * Read state is a single "seen up to" timestamp in localStorage. Deliberately
 * device-local: the desktop's cross-device read state is NIP-44 encrypted to
 * self with last-write-wins semantics, and a half-faithful implementation
 * would corrupt the desktop's copy. A local marker is honest and safe.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { NostrEvent } from "@/shared/lib/nostr-client";
import { getSocket } from "@/shared/lib/nostr-socket";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { relayWsUrl } from "@/shared/lib/relay-url";

const MENTION_KINDS = [9, 1, 40002];
const KIND_APPROVAL_REQUEST = 46010;
const KIND_APPROVAL_GRANTED = 46011;
const KIND_APPROVAL_DENIED = 46012;
const KIND_APPROVAL_GRANT = 46030;
const KIND_APPROVAL_DENY = 46031;
const LIMIT = 50;

const SEEN_KEY = "hive.inbox.seen";

export function inboxSeenMarker(): number {
  const raw = localStorage.getItem(SEEN_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export type InboxItem = {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  createdAt: number;
  /** Channel id for chat messages; null for pulse notes. */
  channelId: string | null;
  unread: boolean;
};

export type ApprovalItem = {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  /** The token a grant or deny must echo back. */
  token: string | null;
  /** Set once somebody answered it. */
  resolved: "granted" | "denied" | null;
};

export function useInbox(selfPubkey: string): {
  items: InboxItem[];
  approvals: ApprovalItem[];
  loading: boolean;
  unreadCount: number;
  markAllRead: () => void;
  answerApproval: (
    item: ApprovalItem,
    grant: boolean,
  ) => Promise<string | null>;
} {
  const socket = useMemo(() => getSocket(relayWsUrl()), []);
  const [events, setEvents] = useState<Map<string, NostrEvent>>(new Map());
  const [resolutions, setResolutions] = useState<
    Map<string, "granted" | "denied">
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [seen, setSeen] = useState(inboxSeenMarker);

  useEffect(() => {
    if (!selfPubkey) {
      return;
    }
    const me = selfPubkey.toLowerCase();
    const unsubscribe = socket.subscribe(
      [
        { kinds: MENTION_KINDS, "#p": [me], limit: LIMIT },
        { kinds: [KIND_APPROVAL_REQUEST], "#p": [me], limit: 20 },
        { kinds: [KIND_APPROVAL_GRANTED, KIND_APPROVAL_DENIED], limit: 50 },
      ],
      {
        onEvent: (event) => {
          if (
            event.kind === KIND_APPROVAL_GRANTED ||
            event.kind === KIND_APPROVAL_DENIED
          ) {
            // Resolutions reference the request by `e` tag.
            const target = event.tags.find((t) => t[0] === "e")?.[1];
            if (target) {
              setResolutions((prev) => {
                const next = new Map(prev);
                next.set(
                  target,
                  event.kind === KIND_APPROVAL_GRANTED ? "granted" : "denied",
                );
                return next;
              });
            }
            return;
          }
          // Own messages p-tag other people; they are outbox, not inbox.
          if (event.pubkey.toLowerCase() === me) {
            return;
          }
          setEvents((prev) => {
            if (prev.has(event.id)) {
              return prev;
            }
            const next = new Map(prev);
            next.set(event.id, event);
            return next;
          });
        },
        onEose: () => setLoading(false),
        onClosed: () => setLoading(false),
      },
    );
    return unsubscribe;
  }, [socket, selfPubkey]);

  const { items, approvals } = useMemo(() => {
    const mentionItems: InboxItem[] = [];
    const approvalItems: ApprovalItem[] = [];
    for (const event of events.values()) {
      if (event.kind === KIND_APPROVAL_REQUEST) {
        approvalItems.push({
          id: event.id,
          pubkey: event.pubkey.toLowerCase(),
          content: event.content,
          createdAt: event.created_at,
          token: event.tags.find((t) => t[0] === "t")?.[1] ?? null,
          resolved: resolutions.get(event.id) ?? null,
        });
        continue;
      }
      mentionItems.push({
        id: event.id,
        kind: event.kind,
        pubkey: event.pubkey.toLowerCase(),
        content: event.content,
        createdAt: event.created_at,
        channelId: event.tags.find((t) => t[0] === "h")?.[1] ?? null,
        unread: event.created_at > seen,
      });
    }
    mentionItems.sort((a, b) => b.createdAt - a.createdAt);
    approvalItems.sort((a, b) => b.createdAt - a.createdAt);
    return { items: mentionItems, approvals: approvalItems };
  }, [events, resolutions, seen]);

  const unreadCount = useMemo(
    () =>
      items.filter((i) => i.unread).length +
      approvals.filter((a) => !a.resolved && a.createdAt > seen).length,
    [items, approvals, seen],
  );

  const markAllRead = useCallback(() => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem(SEEN_KEY, String(now));
    setSeen(now);
  }, []);

  const answerApproval = useCallback(
    async (item: ApprovalItem, grant: boolean): Promise<string | null> => {
      if (!item.token) {
        return "this request carries no approval token";
      }
      const signed = await signNostrEvent({
        kind: grant ? KIND_APPROVAL_GRANT : KIND_APPROVAL_DENY,
        tags: [["t", item.token]],
        content: "",
      });
      const { accepted, reason } = await socket.publish(signed);
      return accepted ? null : reason || "the relay refused it";
    },
    [socket],
  );

  return {
    items,
    approvals,
    loading,
    unreadCount,
    markAllRead,
    answerApproval,
  };
}

/**
 * The sidebar badge: unread mentions only, cheap enough to run inside chat.
 * Uses `since` so the relay does the filtering instead of the browser.
 */
export function useInboxUnread(selfPubkey: string): number {
  const socket = useMemo(() => getSocket(relayWsUrl()), []);
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!selfPubkey) {
      return;
    }
    const me = selfPubkey.toLowerCase();
    const marker = inboxSeenMarker();
    const unsubscribe = socket.subscribe(
      [{ kinds: MENTION_KINDS, "#p": [me], since: marker + 1, limit: LIMIT }],
      {
        onEvent: (event) => {
          if (event.pubkey.toLowerCase() === me) {
            return;
          }
          setIds((prev) => {
            if (prev.has(event.id)) {
              return prev;
            }
            const next = new Set(prev);
            next.add(event.id);
            return next;
          });
        },
      },
    );
    return unsubscribe;
  }, [socket, selfPubkey]);

  return ids.size;
}
