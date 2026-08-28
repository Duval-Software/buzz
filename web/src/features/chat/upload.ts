/**
 * Uploading media to the relay's store (Blossom BUD-02), from the browser.
 *
 * The request goes to OUR origin's `/upload`, which both dev and production
 * proxy to the relay — the relay itself has no CORS on this endpoint (checked
 * live, the preflight is refused). The Host header is rewritten to the relay
 * at the proxy, because that is how it binds the request to the community.
 *
 * The auth contract, learned the hard way on the announcer's card upload:
 * kind 24242 with `t upload` / `x <sha>` / `expiration` tags, base64url in
 * the Authorization header, AND the mandatory `X-SHA-256` header — whose
 * absence produces the same generic "authentication failed" as a bad
 * signature.
 */

import { relayHttpBaseUrl } from "@/shared/lib/relay-url";
import { signNostrEvent } from "@/shared/lib/nostr-signer";

const KIND_BLOSSOM_AUTH = 24242;
/** Matches the relay's own cap for images; refuse locally with a better message. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type UploadedMedia = {
  url: string;
  sha256: string;
  size: number;
  mime: string;
  dim: string | null;
  /** Seconds, for voice notes and video. */
  duration?: number;
  /** Voice notes carry their `voice-note-*.mp4` name so renderers can tell
   * them apart from ordinary video. */
  filename?: string;
};

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Read the pixel size so the imeta tag can declare dimensions. */
function imageDimensions(file: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(`${img.naturalWidth}x${img.naturalHeight}`);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export async function uploadImage(file: File): Promise<UploadedMedia> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only images for now.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("That image is over 10 MB; the relay will refuse it.");
  }
  const media = await uploadBytes(
    await file.arrayBuffer(),
    file.type,
    MAX_IMAGE_BYTES,
  );
  return { ...media, dim: await imageDimensions(file) };
}

/** The raw Blossom PUT, shared by images and voice notes. */
export async function uploadBytes(
  bytes: ArrayBuffer,
  mime: string,
  maxBytes: number,
): Promise<UploadedMedia> {
  if (bytes.byteLength > maxBytes) {
    throw new Error("That file is too large; the relay will refuse it.");
  }
  const sha = await sha256Hex(bytes);
  const relayHost = new URL(relayHttpBaseUrl()).host;

  const auth = await signNostrEvent({
    kind: KIND_BLOSSOM_AUTH,
    content: "Upload file",
    tags: [
      ["t", "upload"],
      ["x", sha],
      ["expiration", String(Math.floor(Date.now() / 1000) + 600)],
      // The server tag names the RELAY, not our origin: the validator compares
      // it against the host the request is bound to, which the proxy rewrites.
      ["server", relayHost],
    ],
  });

  const response = await fetch("/upload", {
    method: "PUT",
    body: bytes,
    headers: {
      "Content-Type": mime,
      "X-SHA-256": sha,
      Authorization: `Nostr ${btoa(JSON.stringify(auth))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "")}`,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    let message = `upload failed (${response.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) {
        message = parsed.error;
      }
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }

  const desc = JSON.parse(text) as {
    url: string;
    sha256: string;
    size: number;
    type: string;
  };
  if (!desc.url || desc.sha256 !== sha) {
    throw new Error("the relay returned a mismatched descriptor");
  }
  return {
    url: desc.url,
    sha256: desc.sha256,
    size: desc.size,
    mime: desc.type || mime,
    dim: null,
  };
}

/** The imeta tag for a send, in the exact shape both native clients parse. */
export function imetaTagFor(media: UploadedMedia): string[] {
  const tag = [
    "imeta",
    `url ${media.url}`,
    `m ${media.mime}`,
    `x ${media.sha256}`,
    `size ${media.size}`,
  ];
  if (media.dim) {
    tag.push(`dim ${media.dim}`);
  }
  if (media.duration != null) {
    tag.push(`duration ${media.duration}`);
  }
  if (media.filename) {
    tag.push(`filename ${media.filename}`);
  }
  return tag;
}
