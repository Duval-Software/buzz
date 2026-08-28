/**
 * Media attached to messages (NIP-92 imeta), the read side.
 *
 * The wire convention, matching what the desktop composer sends and the
 * LIVE-card announcer produces: the event carries one `imeta` tag per
 * attachment (`["imeta", "url <u>", "m <mime>", "dim <WxH>", …]`) plus a
 * markdown line `![image](url)` in the content for renderers that key off the
 * body. We render from the TAGS and hide the markdown lines — showing both
 * would draw every attachment twice.
 *
 * Only relay-hosted media is rendered (`<relay-origin>/media/…`). A message
 * body can name any URL, and turning arbitrary URLs into auto-fetched images
 * would let any member make every reader's browser call a host of the
 * author's choosing. The relay's media store is the one origin every reader
 * already talks to. Same trust rule the desktop applies to preview images.
 */

import { relayHttpBaseUrl } from "@/shared/lib/relay-url";
import type { NostrEvent } from "@/shared/lib/nostr-client";

export type MessageMedia = {
  url: string;
  mime: string;
  /** width/height when declared, for reserving layout space. */
  ratio: number | null;
  kind: "image" | "video" | "voice";
  /** Declared seconds, for voice-note duration labels. */
  duration: number | null;
};

const MEDIA_PATH_RE = /^\/media\/[0-9a-f]{64}\.[a-z0-9]{1,8}$/;

/** Exported for custom emoji, which follow the same relay-hosted-only rule. */
export function isRelayMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const relay = new URL(relayHttpBaseUrl());
    return (
      url.protocol === "https:" &&
      url.host === relay.host &&
      url.search === "" &&
      url.hash === "" &&
      MEDIA_PATH_RE.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/** Parse the renderable attachments out of a message's tags. */
export function mediaFromTags(tags: string[][]): MessageMedia[] {
  const out: MessageMedia[] = [];
  for (const tag of tags) {
    if (tag[0] !== "imeta") {
      continue;
    }
    let url = "";
    let mime = "";
    let dim = "";
    let filename = "";
    let duration: number | null = null;
    for (const part of tag.slice(1)) {
      const sep = part.indexOf(" ");
      if (sep <= 0) {
        continue;
      }
      const key = part.slice(0, sep);
      const value = part.slice(sep + 1);
      if (key === "url") {
        url = value;
      } else if (key === "m") {
        mime = value;
      } else if (key === "dim") {
        dim = value;
      } else if (key === "filename") {
        filename = value;
      } else if (key === "duration") {
        const n = Number(value);
        duration = Number.isFinite(n) && n > 0 ? n : null;
      }
    }
    if (!url || !isRelayMediaUrl(url)) {
      continue;
    }
    // Voice notes travel as audio-only MP4 through the video pipeline
    // (the relay refuses raw audio uploads), marked by their filename.
    // Plain audio mimes count too, for interop with clients that send them.
    const lowerName = filename.toLowerCase();
    const isVoiceNote =
      mime.startsWith("audio/") ||
      (mime === "video/mp4" &&
        lowerName.startsWith("voice-note-") &&
        lowerName.endsWith(".mp4"));
    const kind = isVoiceNote
      ? "voice"
      : mime.startsWith("video/")
        ? "video"
        : mime.startsWith("image/")
          ? "image"
          : null;
    if (!kind) {
      continue;
    }
    let ratio: number | null = null;
    const match = /^(\d+)x(\d+)$/.exec(dim);
    if (match) {
      const w = Number(match[1]);
      const h = Number(match[2]);
      if (w > 0 && h > 0) {
        ratio = w / h;
      }
    }
    out.push({ url, mime, ratio, kind, duration });
  }
  return out;
}

/**
 * The content with attachment markdown lines removed.
 *
 * Only lines that are NOTHING BUT a media reference are dropped; a sentence
 * that happens to mention an image inline keeps its text.
 */
export function contentWithoutMediaLines(content: string): string {
  return content
    .split("\n")
    .filter((line) => !/^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(line))
    .join("\n")
    .trim();
}

/**
 * The attachment markdown lines alone, for re-appending after a text edit.
 * An edit rewrites the whole body, and other clients render attachments from
 * the body line as well as the tag — dropping it would half-detach the image.
 */
export function mediaLinesOf(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => /^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(line));
}

/** Convenience: everything MessageRow needs, from the raw event. */
export function mediaOf(event: NostrEvent): MessageMedia[] {
  return mediaFromTags(event.tags);
}
