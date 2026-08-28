/**
 * Live channel and message state for the chat view.
 *
 * Everything here rides one shared relay socket, so opening a channel adds a
 * subscription rather than a connection. Messages arrive as they are sent; no
 * polling and no refresh.
 *
 * Edits and deletes are OVERLAYS, not mutations. The base timeline is the
 * kind:9 events; kind:40003 edits and kind:5 deletes are kept in their own
 * maps and applied when the visible list is derived. That makes arrival order
 * irrelevant — history replays newest-first, so an edit routinely arrives
 * before the message it edits — and means a bogus edit can be ignored at one
 * choke point instead of being un-applied.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KIND_CHANNEL_METADATA,
  KIND_CHAT,
  KIND_DELETE,
  KIND_EDIT,
  chatTags,
  mentionTags,
  replyTarget,
  type ThreadRef,
  threadRootOf,
} from "@/features/chat/chat-events";
import { mediaOf, type MessageMedia } from "@/features/chat/message-media";
import { emojiFromTags } from "@/features/chat/rich-text";
import { imetaTagFor, type UploadedMedia } from "@/features/chat/upload";
import { loadIdentity } from "@/shared/lib/identity";
import type { NostrEvent } from "@/shared/lib/nostr-client";
import { getSocket, type ConnectionState } from "@/shared/lib/nostr-socket";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { relayWsUrl } from "@/shared/lib/relay-url";

const HISTORY_LIMIT = 200;

export type Channel = {
  id: string;
  name: string;
  about?: string;
  /** Relay-managed direct messages are channels too, tagged ["t","dm"]. */
  kind: "channel" | "dm";
  /** For DMs: everyone in the conversation, including the reader. */
  participants: string[];
};

export type ChatMessage = {
  id: string;
  channelId: string;
  pubkey: string;
  content: string;
  createdAt: number;
  /** The thread this belongs to: a root message's own id, or its root's id. */
  threadRoot: string;
  /** The message this is a reply to, when it is one. */
  replyTo: string | null;
  /** Relay-hosted attachments (NIP-92 imeta), already vetted for rendering. */
  media: MessageMedia[];
  /** Pubkeys this message notifies (its `p` tags), lowercased. */
  mentions: string[];
  /** NIP-30 custom emoji available in this message: shortcode → relay url. */
  emoji: Map<string, string>;
  /** When an edit has been applied, the edit's timestamp. */
  editedAt?: number;
  /**
   * Attachment-bearing tags of the CURRENT state (imeta + emoji), carried
   * through verbatim when this message is edited. An edit's tag set replaces
   * the original's on every client, so an edit that forgot the imeta tags
   * would strip the images off a message just by fixing a typo.
   */
  carryTags: string[][];
  /** True while the relay has not yet acknowledged our own message. */
  pending?: boolean;
  /** Set when the relay refused it, so the UI can show why. */
  failed?: string;
};

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

function carryTagsOf(event: NostrEvent): string[][] {
  return event.tags.filter((t) => t[0] === "imeta" || t[0] === "emoji");
}

function mentionsOf(event: NostrEvent): string[] {
  return event.tags
    .filter((t) => t[0] === "p" && typeof t[1] === "string")
    .map((t) => t[1].toLowerCase());
}

function toChannel(event: NostrEvent): Channel | null {
  // The channel id lives in the `d` tag: 39000 is addressable, so `d`
  // identifies the group and `h` is not used here.
  const id = tagValue(event, "d");
  if (!id) {
    return null;
  }
  const isDm = event.tags.some((t) => t[0] === "t" && t[1] === "dm");
  return {
    id,
    name: tagValue(event, "name") ?? id,
    about: tagValue(event, "about"),
    kind: isDm ? "dm" : "channel",
    participants: event.tags
      .filter((t) => t[0] === "p" && typeof t[1] === "string")
      .map((t) => t[1].toLowerCase()),
  };
}

/** Live connection state, for a status indicator. */
export function useRelayState(): ConnectionState {
  const socket = useMemo(() => getSocket(relayWsUrl()), []);
  const [state, setState] = useState<ConnectionState>(socket.getState());
  useEffect(() => socket.onStateChange(setState), [socket]);
  return state;
}

/** Every channel this member can see, kept current as they change. */
export function useChannels(): { channels: Channel[]; loading: boolean } {
  const socket = useMemo(() => getSocket(relayWsUrl()), []);
  const [byId, setById] = useState<Map<string, Channel>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = socket.subscribe(
      [{ kinds: [KIND_CHANNEL_METADATA], limit: 200 }],
      {
        onEvent: (event) => {
          const channel = toChannel(event);
          if (!channel) {
            return;
          }
          setById((prev) => {
            const next = new Map(prev);
            next.set(channel.id, channel);
            return next;
          });
        },
        onEose: () => setLoading(false),
        onClosed: () => setLoading(false),
      },
    );
    return unsubscribe;
  }, [socket]);

  const channels = useMemo(
    () =>
      [...byId.values()].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [byId],
  );

  return { channels, loading };
}

/**
 * Messages for one channel, oldest first, updating live.
 *
 * Sending is optimistic: the message appears immediately marked pending, then
 * settles when the relay accepts it, or shows why it was refused. Silent drops
 * are the worst outcome in chat, so a refusal is always visible.
 */
export function useMessages(channelId: string | null): {
  messages: ChatMessage[];
  loading: boolean;
  send: (
    text: string,
    thread?: ThreadRef,
    attachments?: UploadedMedia[],
    mentions?: string[],
  ) => Promise<void>;
  /** Edit one of our own messages. Attachments are preserved. */
  editMessage: (message: ChatMessage, newText: string) => Promise<void>;
  /** Delete one of our own messages. */
  deleteMessage: (message: ChatMessage) => Promise<void>;
} {
  const socket = useMemo(() => getSocket(relayWsUrl()), []);
  const [base, setBase] = useState<ChatMessage[]>([]);
  const [edits, setEdits] = useState<Map<string, NostrEvent>>(new Map());
  const [deletions, setDeletions] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(Boolean(channelId));
  // Our own optimistic ids, so the echo from the relay replaces rather than
  // duplicates them.
  const pendingIds = useRef<Set<string>>(new Set());

  const noteEdit = useCallback((event: NostrEvent) => {
    const target = event.tags.find((t) => t[0] === "e")?.[1];
    if (!target) {
      return;
    }
    setEdits((prev) => {
      const current = prev.get(target);
      if (current && current.created_at >= event.created_at) {
        return prev;
      }
      const next = new Map(prev);
      next.set(target, event);
      return next;
    });
  }, []);

  useEffect(() => {
    setBase([]);
    setEdits(new Map());
    setDeletions(new Map());
    pendingIds.current.clear();
    if (!channelId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const unsubscribe = socket.subscribe(
      [
        { kinds: [KIND_CHAT], "#h": [channelId], limit: HISTORY_LIMIT },
        // Edits and deletes are rarer than messages, so the same cap reaches
        // further back than the messages it can apply to. Harmless: an
        // overlay without a base event is simply never consulted.
        {
          kinds: [KIND_EDIT, KIND_DELETE],
          "#h": [channelId],
          limit: HISTORY_LIMIT,
        },
      ],
      {
        onEvent: (event) => {
          if (event.kind === KIND_EDIT) {
            noteEdit(event);
            return;
          }
          if (event.kind === KIND_DELETE) {
            const target = event.tags.find((t) => t[0] === "e")?.[1];
            if (target) {
              setDeletions((prev) => {
                const next = new Map(prev);
                next.set(target, event.pubkey.toLowerCase());
                return next;
              });
            }
            return;
          }
          setBase((prev) => {
            if (prev.some((m) => m.id === event.id && !m.pending)) {
              return prev;
            }
            pendingIds.current.delete(event.id);
            const next = [
              ...prev.filter((m) => m.id !== event.id),
              {
                id: event.id,
                channelId,
                pubkey: event.pubkey,
                content: event.content,
                createdAt: event.created_at,
                threadRoot: threadRootOf(event),
                replyTo: replyTarget(event),
                media: mediaOf(event),
                mentions: mentionsOf(event),
                emoji: emojiFromTags(event.tags),
                carryTags: carryTagsOf(event),
              },
            ];
            next.sort((a, b) => a.createdAt - b.createdAt);
            return next;
          });
        },
        onEose: () => setLoading(false),
        onClosed: () => setLoading(false),
      },
    );
    return unsubscribe;
  }, [socket, channelId, noteEdit]);

  // The visible timeline: base events with edit and delete overlays applied.
  const messages = useMemo(() => {
    const out: ChatMessage[] = [];
    for (const message of base) {
      // Only the author may remove a message. The relay enforces this on
      // ingest; checking again here means a hostile stored event still cannot
      // vanish someone else's words.
      if (deletions.get(message.id) === message.pubkey.toLowerCase()) {
        continue;
      }
      const edit = edits.get(message.id);
      if (!edit || edit.pubkey.toLowerCase() !== message.pubkey.toLowerCase()) {
        out.push(message);
        continue;
      }
      out.push({
        ...message,
        content: edit.content,
        media: mediaOf(edit),
        emoji: emojiFromTags(edit.tags),
        // An edit may add people; it never un-notifies the original's.
        mentions: [...new Set([...message.mentions, ...mentionsOf(edit)])],
        carryTags: carryTagsOf(edit),
        editedAt: edit.created_at,
      });
    }
    return out;
  }, [base, edits, deletions]);

  const send = useCallback(
    async (
      text: string,
      thread?: ThreadRef,
      attachments?: UploadedMedia[],
      mentions?: string[],
    ) => {
      let body = text.trim();
      if ((!body && !attachments?.length) || !channelId) {
        return;
      }
      // The markdown line in the body plus the imeta tag is the wire shape
      // the desktop composer produces; both native clients render from it.
      const tags = chatTags(channelId, thread);
      for (const media of attachments ?? []) {
        // Voice notes are audio-only MP4, so they take the video media line.
        const label = media.mime.startsWith("video/") ? "video" : "image";
        body = body
          ? `${body}\n![${label}](${media.url})`
          : `![${label}](${media.url})`;
        tags.push(imetaTagFor(media));
      }
      // Tags are part of what gets signed, so the self-mention filter needs
      // our pubkey BEFORE signing — stripping afterwards would break the sig.
      const self = loadIdentity()?.pubkey ?? "";
      const signed = await signNostrEvent({
        kind: KIND_CHAT,
        tags: [...tags, ...mentionTags(mentions ?? [], self)],
        content: body,
      });

      pendingIds.current.add(signed.id);
      setBase((prev) =>
        prev.some((m) => m.id === signed.id)
          ? prev
          : [
              ...prev,
              {
                id: signed.id,
                channelId,
                pubkey: signed.pubkey,
                content: signed.content,
                createdAt: signed.created_at,
                threadRoot: thread?.rootId ?? signed.id,
                replyTo: thread?.parentId ?? null,
                media: mediaOf(signed),
                mentions: mentionsOf(signed),
                emoji: emojiFromTags(signed.tags),
                carryTags: carryTagsOf(signed),
                pending: true,
              },
            ],
      );

      const { accepted, reason } = await socket.publish(signed);
      setBase((prev) =>
        prev.map((m) =>
          m.id === signed.id
            ? {
                ...m,
                pending: false,
                failed: accepted ? undefined : reason || "the relay refused it",
              }
            : m,
        ),
      );
    },
    [socket, channelId],
  );

  const editMessage = useCallback(
    async (message: ChatMessage, newText: string) => {
      const body = newText.trim();
      if (!channelId || (!body && message.carryTags.length === 0)) {
        return;
      }
      const signed = await signNostrEvent({
        kind: KIND_EDIT,
        tags: [["h", channelId], ["e", message.id], ...message.carryTags],
        content: body,
      });
      const { accepted, reason } = await socket.publish(signed);
      if (!accepted) {
        throw new Error(reason || "the relay refused the edit");
      }
      // The relay echoes the edit back through the live subscription, but
      // applying it now keeps the UI honest even on a slow round-trip.
      noteEdit(signed);
    },
    [socket, channelId, noteEdit],
  );

  const deleteMessage = useCallback(
    async (message: ChatMessage) => {
      if (!channelId) {
        return;
      }
      // One target per deletion is a relay rule, not a style choice.
      const signed = await signNostrEvent({
        kind: KIND_DELETE,
        tags: [
          ["h", channelId],
          ["e", message.id],
        ],
        content: "",
      });
      const { accepted, reason } = await socket.publish(signed);
      if (!accepted) {
        throw new Error(reason || "the relay refused the delete");
      }
      setDeletions((prev) => {
        const next = new Map(prev);
        next.set(message.id, signed.pubkey.toLowerCase());
        return next;
      });
    },
    [socket, channelId],
  );

  return { messages, loading, send, editMessage, deleteMessage };
}
