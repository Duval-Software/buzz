/**
 * Inline message decoration: @mentions and NIP-30 custom emoji.
 *
 * The wire convention (desktop and mobile agree): a mention is the PLAIN TEXT
 * `@Name` in the body plus a `p` tag with the pubkey. Nothing in the text ties
 * a name to a key, so rendering works backwards — take the event's `p` tags,
 * resolve each to a display name, and highlight where that name appears after
 * an `@`. A `p` tag whose name never appears stays invisible, which is also
 * what the desktop does.
 *
 * Custom emoji are `:shortcode:` in the body plus one `["emoji", code, url]`
 * tag per code. Only relay-hosted urls are rendered, the same privacy rule as
 * attachments: message tags can name any host, and an auto-fetched <img> is a
 * tracking beacon to whoever controls it.
 */

import { isRelayMediaUrl } from "@/features/chat/message-media";

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; pubkey: string }
  | { kind: "emoji"; code: string; url: string };

/** NIP-30 shortcode alphabet; anything stranger is left as literal text. */
const EMOJI_CODE_RE = /^[a-zA-Z0-9_+-]+$/;

/** Parse `["emoji", code, url]` tags into a render map, relay-hosted only. */
export function emojiFromTags(tags: string[][]): Map<string, string> {
  const out = new Map<string, string>();
  for (const tag of tags) {
    if (
      tag[0] === "emoji" &&
      typeof tag[1] === "string" &&
      EMOJI_CODE_RE.test(tag[1]) &&
      typeof tag[2] === "string" &&
      isRelayMediaUrl(tag[2])
    ) {
      out.set(tag[1], tag[2]);
    }
  }
  return out;
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split a message body into text, mention, and emoji segments.
 *
 * `mentionNames` maps display name → pubkey for the event's `p` tags. Names
 * are matched longest-first so "@Lucas Wyman" wins over a hypothetical
 * "@Lucas", with the same boundaries the desktop matcher uses: preceded by
 * start/whitespace/punctuation, followed by end/whitespace/punctuation.
 */
export function segmentContent(
  content: string,
  mentionNames: Map<string, string>,
  emoji: Map<string, string>,
): Segment[] {
  const names = [...mentionNames.keys()]
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length);

  const parts: string[] = [];
  if (names.length > 0) {
    parts.push(`@(?:${names.map(escapeRegExp).join("|")})`);
  }
  if (emoji.size > 0) {
    parts.push(`:(?:${[...emoji.keys()].map(escapeRegExp).join("|")}):`);
  }
  if (parts.length === 0 || content.length === 0) {
    return content ? [{ kind: "text", text: content }] : [];
  }

  const matcher = new RegExp(
    `(^|[\\s([{*_])(${parts.join("|")})(?=$|[\\s,;.!?:)\\]}*_])`,
    "gi",
  );

  const segments: Segment[] = [];
  let cursor = 0;
  for (const match of content.matchAll(matcher)) {
    const hit = match[2];
    const start = match.index + match[1].length;
    if (start > cursor) {
      segments.push({ kind: "text", text: content.slice(cursor, start) });
    }
    if (hit.startsWith("@")) {
      // Case-insensitive match, so resolve through the canonical name list.
      const canonical = names.find(
        (name) => name.toLowerCase() === hit.slice(1).toLowerCase(),
      );
      const pubkey = canonical ? mentionNames.get(canonical) : undefined;
      if (pubkey) {
        segments.push({ kind: "mention", text: hit, pubkey });
      } else {
        segments.push({ kind: "text", text: hit });
      }
    } else {
      const code = hit.slice(1, -1);
      const url = emoji.get(code);
      if (url) {
        segments.push({ kind: "emoji", code, url });
      } else {
        segments.push({ kind: "text", text: hit });
      }
    }
    cursor = start + hit.length;
  }
  if (cursor < content.length) {
    segments.push({ kind: "text", text: content.slice(cursor) });
  }
  return segments;
}
