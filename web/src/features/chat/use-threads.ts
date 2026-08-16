/**
 * Threads, assembled from the messages already on screen.
 *
 * Every message carries `threadRoot` (its own id when it starts a thread, its
 * root's id when it is a reply), which is all a thread view needs. Grouping by
 * that is enough to show a conversation and to count its replies.
 *
 * # Why this does not use kind:39005
 *
 * The relay does publish a thread-summary overlay with authoritative
 * `reply_count`, `descendant_count`, `last_reply_at` and `participants`. It is
 * NOT subscribable: it is relay-signed and synthesised at query time, appended
 * only to `POST /query` responses for `top_level` window requests over the HTTP
 * bridge. Reaching for it would mean a second transport and a second paging
 * model beside the live socket.
 *
 * The tradeoff, stated plainly: counts here are over the messages this client
 * has loaded (the most recent few hundred), so a thread whose replies fall
 * outside that window will read low. For a channel being actively followed
 * that is the same set the person is already looking at. Wiring up the overlay
 * is the upgrade path when accurate counts on old threads start to matter.
 */

import { useMemo } from "react";
import type { ChatMessage } from "@/features/chat/use-chat";

export type Thread = {
  root: ChatMessage;
  /** Replies in the order they were sent, excluding the root. */
  replies: ChatMessage[];
  /** Distinct people who have spoken in the thread, including the root author. */
  participants: string[];
};

/** Replies for every thread in the loaded window, keyed by root id. */
export function useThreadIndex(
  messages: ChatMessage[],
): Map<string, ChatMessage[]> {
  return useMemo(() => {
    const byRoot = new Map<string, ChatMessage[]>();
    for (const message of messages) {
      // A root's threadRoot is its own id, so it is not a reply to itself.
      if (message.threadRoot === message.id) {
        continue;
      }
      const existing = byRoot.get(message.threadRoot);
      if (existing) {
        existing.push(message);
      } else {
        byRoot.set(message.threadRoot, [message]);
      }
    }
    for (const replies of byRoot.values()) {
      replies.sort((a, b) => a.createdAt - b.createdAt);
    }
    return byRoot;
  }, [messages]);
}

/** Build one thread for the panel, or null if its root is not loaded. */
export function buildThread(
  rootId: string | null,
  messages: ChatMessage[],
  index: Map<string, ChatMessage[]>,
): Thread | null {
  if (!rootId) {
    return null;
  }
  const root = messages.find((m) => m.id === rootId);
  if (!root) {
    return null;
  }
  const replies = index.get(rootId) ?? [];
  const participants: string[] = [];
  for (const message of [root, ...replies]) {
    if (!participants.includes(message.pubkey)) {
      participants.push(message.pubkey);
    }
  }
  return { root, replies, participants };
}

/**
 * The timeline shows one row per thread rather than every reply inline.
 *
 * Without this a busy thread floods the channel and pushes unrelated
 * conversation off the screen, which is the problem threads exist to solve.
 * Replies stay reachable through the thread panel.
 */
export function topLevelOnly(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.threadRoot === m.id);
}
