/** Community build updates use existing note/edit/delete/reaction events, without channel scope. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { mediaOf, type MessageMedia } from "@/features/chat/message-media";
import { imetaTagFor, type UploadedMedia } from "@/features/chat/upload";
import type { NostrEvent } from "@/shared/lib/nostr-client";
import { getSocket } from "@/shared/lib/nostr-socket";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { relayWsUrl } from "@/shared/lib/relay-url";

export const POST_TYPES = {
  progress: "Progress update",
  shipped: "Shipped",
  feedback: "Feedback wanted",
} as const;
export type PostType = keyof typeof POST_TYPES;
export type PulseNote = {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  replyTo: string | null;
  media: MessageMedia[];
  tags: string[][];
  postType: PostType;
  project: string;
  projectUrl: string;
  resolved: boolean;
  outcome: string;
  editedAt?: number;
};
export type PostOptions = {
  postType?: PostType;
  project?: string;
  projectUrl?: string;
  attachment?: UploadedMedia;
  reply?: PulseNote;
};

/** Only navigable web URLs can identify a build; credentials and fragments are excluded. */
export function buildUrl(value: string): string {
  if (!value.trim() || value.length > 2048) return "";
  try {
    const url = new URL(value.trim());
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}
/** Follow a creator's specific build, never every post containing the same URL. */
export function buildKey(note: PulseNote): string {
  return `${note.pubkey}:${note.projectUrl}`;
}
function toNote(event: NostrEvent): PulseNote {
  const tag = (key: string) => event.tags.find((t) => t[0] === key)?.[1] ?? "";
  const type = tag("hive-post");
  return {
    id: event.id,
    pubkey: event.pubkey.toLowerCase(),
    content: event.content,
    createdAt: event.created_at,
    replyTo:
      event.tags.find(
        (t) => t[0] === "e" && (t[3] === "reply" || t.length === 2),
      )?.[1] ?? null,
    media: mediaOf(event),
    tags: event.tags,
    postType: type === "shipped" || type === "feedback" ? type : "progress",
    project: tag("hive-project").slice(0, 80),
    projectUrl: buildUrl(tag("hive-build")),
    resolved: tag("hive-feedback") === "resolved",
    outcome: tag("hive-outcome").slice(0, 2000),
  };
}

export function usePulse(selfPubkey: string, targetId?: string) {
  const socket = useMemo(() => getSocket(relayWsUrl()), []);
  const [base, setBase] = useState<Map<string, NostrEvent>>(new Map());
  const [overlays, setOverlays] = useState<Map<string, NostrEvent>>(new Map());
  const [loading, setLoading] = useState(true);
  const [targetLoading, setTargetLoading] = useState(Boolean(targetId));
  const [targetError, setTargetError] = useState("");
  const [targetRetry, setTargetRetry] = useState(0);
  const remember = useCallback((event: NostrEvent) => {
    const setter = event.kind === 1 ? setBase : setOverlays;
    setter((previous) =>
      previous.has(event.id)
        ? previous
        : new Map(previous).set(event.id, event),
    );
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry reloads the linked update.
  useEffect(() => {
    let cancelled = false;
    setTargetError("");
    setTargetLoading(Boolean(targetId));
    if (!targetId) return;
    void (async () => {
      try {
        const events = await socket.queryOnce([
          { kinds: [1], ids: [targetId], limit: 1 },
          { kinds: [1], "#e": [targetId], limit: 100 },
        ]);
        const notes = events.filter(
          (event) =>
            event.kind === 1 && !event.tags.some((tag) => tag[0] === "h"),
        );
        const target = notes.find((event) => event.id === targetId);
        if (!target)
          throw new Error(
            "This update is unavailable. It may have been deleted or your access changed.",
          );
        const overlays = await socket.queryOnce([
          {
            kinds: [5, 40003, 7],
            "#e": notes.map((event) => event.id),
            limit: 500,
          },
        ]);
        if (cancelled) return;
        for (const event of [...notes, ...overlays]) remember(event);
        if (
          overlays.some(
            (event) =>
              event.kind === 5 &&
              event.pubkey === target.pubkey &&
              event.tags.some((tag) => tag[0] === "e" && tag[1] === target.id),
          )
        )
          throw new Error("This update has been deleted.");
      } catch (cause) {
        if (!cancelled)
          setTargetError(
            cause instanceof Error
              ? cause.message
              : "Could not load this update. Try again.",
          );
      } finally {
        if (!cancelled) setTargetLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [socket, targetId, remember, targetRetry]);
  useEffect(
    () =>
      socket.subscribe([{ kinds: [1], limit: 100 }], {
        onEvent: (event) => {
          if (event.kind === 1 && !event.tags.some((t) => t[0] === "h"))
            remember(event);
        },
        onEose: () => setLoading(false),
        onClosed: () => setLoading(false),
      }),
    [socket, remember],
  );
  const ids = [
    ...base.keys(),
    ...[...overlays.values()].filter((e) => e.kind === 7).map((e) => e.id),
  ]
    .sort()
    .join(",");
  useEffect(() => {
    if (!ids) return;
    return socket.subscribe(
      [{ kinds: [7, 5, 40003], "#e": ids.split(","), limit: 500 }],
      { onEvent: remember },
    );
  }, [socket, ids, remember]);
  const { notes, reactions } = useMemo(() => {
    const events = [...overlays.values()];
    const deleted = (target: NostrEvent) =>
      events.some(
        (e) =>
          e.kind === 5 &&
          e.pubkey === target.pubkey &&
          e.tags.some((t) => t[0] === "e" && t[1] === target.id),
      );
    const notes = [...base.values()]
      .filter((event) => !deleted(event))
      .map((event) => {
        const edit = events
          .filter(
            (e) =>
              e.kind === 40003 &&
              e.pubkey === event.pubkey &&
              !e.tags.some((t) => t[0] === "h") &&
              e.tags.some((t) => t[0] === "e" && t[1] === event.id),
          )
          .sort(
            (a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id),
          )[0];
        if (!edit) return toNote(event);
        return {
          ...toNote({
            ...event,
            content: edit.content,
            tags: edit.tags
              .filter((t) => t[0] !== "e")
              .concat(event.tags.filter((t) => t[0] === "e")),
          }),
          editedAt: edit.created_at,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    return {
      notes,
      reactions: events.filter(
        (e) => e.kind === 7 && e.content === "+" && !deleted(e),
      ),
    };
  }, [base, overlays]);
  const send = useCallback(
    async (
      kind: number,
      content: string,
      tags: string[][],
      createdAt?: number,
    ) => {
      const signed = await signNostrEvent({
        kind,
        content,
        tags,
        created_at: createdAt,
      });
      const { accepted, reason } = await socket.publish(signed);
      if (!accepted)
        throw new Error(reason || "The relay refused this change.");
      if (kind !== 1984) remember(signed);
      return signed;
    },
    [socket, remember],
  );
  const publish = async (text: string, options: PostOptions = {}) => {
    if (!text.trim() || text.length > 10000)
      throw new Error("Write an update of at most 10,000 characters.");
    const tags: string[][] = [];
    if (options.reply) {
      tags.push(["e", options.reply.id, "", "reply"]);
      if (options.reply.pubkey !== selfPubkey)
        tags.push(["p", options.reply.pubkey]);
    } else {
      tags.push(["hive-post", options.postType ?? "progress"]);
      if (options.projectUrl) {
        const url = buildUrl(options.projectUrl);
        if (!url)
          throw new Error(
            "Use a full http:// or https:// build link without a username or password.",
          );
        tags.push(
          ["hive-build", url],
          ["hive-project", (options.project ?? "").trim().slice(0, 80)],
        );
      }
    }
    if (options.attachment) tags.push(imetaTagFor(options.attachment));
    await send(1, text.trim(), tags);
  };
  const edit = async (note: PulseNote, content: string, outcome?: string) => {
    if (note.pubkey !== selfPubkey.toLowerCase())
      throw new Error("Only the author can edit this update.");
    if (!content.trim() || content.length > 10000)
      throw new Error("Keep the update between 1 and 10,000 characters.");
    if (
      outcome !== undefined &&
      (!outcome.trim() || outcome.length > 2000 || note.postType !== "feedback")
    )
      throw new Error("Add a feedback outcome of at most 2,000 characters.");
    const tags = note.tags.filter(
      (t) =>
        t[0] !== "e" &&
        (outcome === undefined ||
          !["hive-feedback", "hive-outcome"].includes(t[0])),
    );
    if (outcome !== undefined)
      tags.push(
        ["hive-feedback", "resolved"],
        ["hive-outcome", outcome.trim()],
      );
    await send(
      40003,
      content.trim(),
      [["e", note.id], ...tags],
      Math.max(
        Math.floor(Date.now() / 1000),
        (note.editedAt ?? note.createdAt) + 1,
      ),
    );
  };
  const remove = async (note: PulseNote) => {
    if (note.pubkey !== selfPubkey.toLowerCase())
      throw new Error("Only the author can delete this update.");
    await send(5, "", [["e", note.id]]);
  };
  const report = async (note: PulseNote, category: string, reason: string) => {
    if (
      !["spam", "illegal", "impersonation", "other"].includes(category) ||
      reason.length > 2000
    )
      throw new Error(
        "Choose a report reason and keep the note under 2,000 characters.",
      );
    await send(1984, reason.trim(), [
      ["e", note.id, category],
      ["p", note.pubkey],
    ]);
  };
  const likesOf = (noteId: string) => {
    const matches = reactions.filter((e) =>
      e.tags.some((t) => t[0] === "e" && t[1] === noteId),
    );
    const mine = matches.find(
      (e) => e.pubkey.toLowerCase() === selfPubkey.toLowerCase(),
    );
    return {
      count: new Set(matches.map((e) => e.pubkey)).size,
      mine: Boolean(mine),
      myLikeId: mine?.id,
    };
  };
  const toggleLike = async (noteId: string) => {
    const current = likesOf(noteId);
    await send(current.myLikeId ? 5 : 7, current.myLikeId ? "" : "+", [
      ["e", current.myLikeId ?? noteId],
    ]);
  };
  return {
    notes,
    loading,
    publish,
    edit,
    remove,
    report,
    likesOf,
    toggleLike,
    targetLoading,
    targetError,
    retryTarget: () => setTargetRetry((n) => n + 1),
  };
}
