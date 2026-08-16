/**
 * Event shapes for chat writes.
 *
 * Tag layouts mirror `crates/buzz-sdk/src/builders.rs` exactly, because the
 * relay and the desktop app both read them. Getting a marker wrong here does
 * not fail loudly, it quietly produces a message that threads incorrectly in
 * every other client, so these are kept in one place rather than inlined at
 * each call site.
 */

import type { NostrEvent } from "@/shared/lib/nostr-client";

/** NIP-29 group chat message. */
export const KIND_CHAT = 9;
/** Full-content edit of a kind:9 message; relay enforces author-only. */
export const KIND_EDIT = 40003;
/** NIP-25 reaction. */
export const KIND_REACTION = 7;
/** Deletion request, used to retract a reaction. */
export const KIND_DELETE = 5;
/** Ephemeral typing indicator (Redis pub/sub only, never stored). */
export const KIND_TYPING = 20002;
/** NIP-29 addressable group metadata. */
export const KIND_CHANNEL_METADATA = 39000;

/** Max emoji length the relay accepts for a reaction. */
export const MAX_EMOJI_CHARS = 64;

export type ThreadRef = {
  /** The event that started the thread. */
  rootId: string;
  /** The specific message being replied to; equals rootId for a direct reply. */
  parentId: string;
};

/**
 * Tags for a chat message, optionally threaded.
 *
 * Matches the SDK:
 * - direct reply (root === parent): `["e", root, "", "reply"]`
 * - nested reply (root !== parent): `["e", root, "", "root"]` + `["e", parent, "", "reply"]`
 */
export function chatTags(channelId: string, thread?: ThreadRef): string[][] {
  const tags: string[][] = [["h", channelId]];
  if (!thread) {
    return tags;
  }
  if (thread.rootId === thread.parentId) {
    tags.push(["e", thread.rootId, "", "reply"]);
  } else {
    tags.push(["e", thread.rootId, "", "root"]);
    tags.push(["e", thread.parentId, "", "reply"]);
  }
  return tags;
}

/**
 * Mention `p` tags: deduped, lowercased, never the sender.
 *
 * These are what notification paths key on — hivepush polls for them and the
 * agent harness wakes on them — so a message that LOOKS like it mentions
 * someone but carries no `p` tag notifies nobody.
 */
export function mentionTags(
  mentions: string[],
  senderPubkey: string,
): string[][] {
  const sender = senderPubkey.toLowerCase();
  return [...new Set(mentions.map((pk) => pk.toLowerCase()))]
    .filter((pk) => /^[0-9a-f]{64}$/.test(pk) && pk !== sender)
    .map((pk) => ["p", pk]);
}

/** Tags for a NIP-25 reaction. The `h` tag keeps it inside the channel. */
export function reactionTags(channelId: string, targetId: string): string[][] {
  return [
    ["e", targetId],
    ["h", channelId],
  ];
}

/** The event id a reply points at, or null for a top-level message. */
export function replyTarget(event: NostrEvent): string | null {
  const eTags = event.tags.filter((t) => t[0] === "e");
  if (eTags.length === 0) {
    return null;
  }
  const marked = eTags.find((t) => t[3] === "reply");
  return marked?.[1] ?? eTags[0]?.[1] ?? null;
}

/** The thread a message belongs to: its root id, or its own id if it is one. */
export function threadRootOf(event: NostrEvent): string {
  const eTags = event.tags.filter((t) => t[0] === "e");
  const root = eTags.find((t) => t[3] === "root");
  if (root?.[1]) {
    return root[1];
  }
  // A direct reply carries only a "reply" marker, and that target IS the root.
  const reply = eTags.find((t) => t[3] === "reply");
  return reply?.[1] ?? event.id;
}

/** Reaction target id, or null if the event is malformed. */
export function reactionTarget(event: NostrEvent): string | null {
  return event.tags.find((t) => t[0] === "e")?.[1] ?? null;
}
