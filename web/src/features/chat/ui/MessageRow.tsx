import { useState } from "react";
import type { ChatMessage } from "@/features/chat/use-chat";
import type { ReactionSummary } from "@/features/chat/use-reactions";
import {
  contentWithoutMediaLines,
  mediaLinesOf,
} from "@/features/chat/message-media";
import { segmentContent } from "@/features/chat/rich-text";
import { useNames } from "@/features/profile/use-profiles";
import { cn } from "@/shared/lib/cn";

/** The quick-reaction set. Anything else can still arrive from other clients. */
const QUICK_EMOJI = ["👍", "🎉", "👀", "🐝"];

/**
 * The message body with mentions and custom emoji rendered inline.
 *
 * Mention names resolve through the event's `p` tags: the tag names WHO is
 * notified, the profile store names what they are called, and the text is
 * highlighted wherever that name follows an `@`. Nothing is trusted from the
 * text alone — an "@Name" with no matching `p` tag stays plain text.
 */
function RichContent({
  message,
  selfPubkey,
}: {
  message: ChatMessage;
  selfPubkey: string;
}) {
  const names = useNames();
  const mentionNames = new Map<string, string>();
  for (const pubkey of message.mentions) {
    mentionNames.set(names(pubkey), pubkey);
  }
  const segments = segmentContent(
    contentWithoutMediaLines(message.content),
    mentionNames,
    message.emoji,
  );
  return (
    <>
      {segments.map((segment, index) => {
        // Segments have no ids; the list is rebuilt whole on every change.
        const key = `${index}-${segment.kind}`;
        if (segment.kind === "mention") {
          const isSelf = segment.pubkey === selfPubkey.toLowerCase();
          return (
            <span
              key={key}
              className={cn(
                "rounded px-0.5 font-medium",
                isSelf
                  ? "bg-amber-500/25 text-amber-200"
                  : "bg-amber-500/10 text-amber-400",
              )}
            >
              {segment.text}
            </span>
          );
        }
        if (segment.kind === "emoji") {
          return (
            <img
              key={key}
              src={segment.url}
              alt={`:${segment.code}:`}
              title={`:${segment.code}:`}
              className="inline-block h-5 w-5 align-text-bottom"
            />
          );
        }
        return <span key={key}>{segment.text}</span>;
      })}
    </>
  );
}

export function MessageRow({
  message,
  reactions,
  selfPubkey,
  replyPreview,
  replyCount = 0,
  onReply,
  onReact,
  onOpenThread,
  onEdit,
  onDelete,
}: {
  message: ChatMessage;
  reactions: ReactionSummary[];
  selfPubkey: string;
  /** The message being replied to, when we have it loaded. */
  replyPreview?: ChatMessage;
  /** Replies to this message's thread, among the messages loaded. */
  replyCount?: number;
  onReply: (message: ChatMessage) => void;
  onReact: (targetId: string, emoji: string) => void;
  onOpenThread?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage, newText: string) => Promise<void>;
  onDelete?: (message: ChatMessage) => Promise<void>;
}) {
  const names = useNames();
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const mine =
    selfPubkey.length > 0 &&
    message.pubkey.toLowerCase() === selfPubkey.toLowerCase() &&
    !message.pending;
  const mentionsMe =
    selfPubkey.length > 0 &&
    message.mentions.includes(selfPubkey.toLowerCase());

  async function saveEdit() {
    const text = editDraft.trim();
    if (!onEdit) {
      return;
    }
    setActionError(null);
    try {
      // The visible text changes; the attachment lines ride along unchanged.
      const body = [text, ...mediaLinesOf(message.content)]
        .filter(Boolean)
        .join("\n");
      await onEdit(message, body);
      setEditing(false);
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "could not save the edit",
      );
    }
  }

  async function confirmDelete() {
    if (!onDelete) {
      return;
    }
    setActionError(null);
    try {
      await onDelete(message);
    } catch (cause) {
      setConfirmingDelete(false);
      setActionError(
        cause instanceof Error ? cause.message : "could not delete",
      );
    }
  }

  return (
    <div
      className={cn(
        "group relative",
        mentionsMe && "-mx-2 rounded-md bg-amber-500/5 px-2",
      )}
    >
      {message.replyTo ? (
        <div className="mb-0.5 flex items-center gap-1 text-neutral-500 text-xs">
          <span aria-hidden="true">↳</span>
          <span className="truncate">
            {replyPreview
              ? `${names(replyPreview.pubkey)}: ${replyPreview.content}`
              : "replying to an earlier message"}
          </span>
        </div>
      ) : null}

      {editing ? (
        <div className="my-1">
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            rows={Math.min(8, Math.max(2, editDraft.split("\n").length))}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-base outline-none focus:border-neutral-500"
          />
          <div className="mt-1 flex gap-2 text-xs">
            <button
              type="button"
              onClick={saveEdit}
              className="rounded bg-amber-500 px-2 py-1 font-semibold text-neutral-950"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded border border-neutral-700 px-2 py-1 text-neutral-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "whitespace-pre-wrap break-words text-base leading-relaxed",
            message.pending && "text-neutral-500",
            message.failed && "text-red-400",
          )}
        >
          <RichContent message={message} selfPubkey={selfPubkey} />
          {message.editedAt ? (
            <span className="ml-1.5 text-neutral-600 text-xs">(edited)</span>
          ) : null}
          {message.failed ? (
            <span className="ml-2 text-red-400 text-xs">
              not sent: {message.failed}
            </span>
          ) : null}
        </div>
      )}

      {actionError ? (
        <p className="mt-0.5 text-red-400 text-xs" role="alert">
          {actionError}
        </p>
      ) : null}

      {(message.media ?? []).length > 0 ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {(message.media ?? []).map((item) =>
            item.kind === "video" ? (
              // biome-ignore lint/a11y/useMediaCaption: user uploads carry no caption track
              <video
                key={item.url}
                src={item.url}
                controls
                preload="metadata"
                className="max-h-80 max-w-md rounded-lg border border-neutral-800 bg-black"
                style={item.ratio ? { aspectRatio: item.ratio } : undefined}
              />
            ) : (
              <a
                key={item.url}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="block max-w-md"
              >
                {/*
                  Eager on purpose. A lazy image with no intrinsic size
                  collapses to zero height, and Chromium never fetches a
                  zero-sized lazy image — the attachment simply never appears
                  (found live, not in review). Timelines are capped at 200
                  messages and media is relay-local, so eager is cheap.
                */}
                <img
                  src={item.url}
                  alt="attachment"
                  className="w-full max-w-md rounded-lg border border-neutral-800 object-contain"
                  style={item.ratio ? { aspectRatio: item.ratio } : undefined}
                />
              </a>
            ),
          )}
        </div>
      ) : null}

      {replyCount > 0 && onOpenThread ? (
        <button
          type="button"
          onClick={() => onOpenThread(message)}
          className="mt-1 rounded px-1 py-0.5 text-amber-400 text-xs hover:bg-neutral-900"
        >
          {replyCount} {replyCount === 1 ? "reply" : "replies"} →
        </button>
      ) : null}

      {reactions.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {reactions.map((reaction) => (
            <button
              key={reaction.emoji}
              type="button"
              onClick={() => onReact(message.id, reaction.emoji)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs",
                reaction.mine
                  ? "border-amber-600 bg-amber-950 text-amber-300"
                  : "border-neutral-700 text-neutral-300 hover:border-neutral-500",
              )}
            >
              {reaction.emoji} {reaction.count}
            </button>
          ))}
        </div>
      ) : null}

      {/* Hover actions. Kept out of the flow so the timeline does not jump. */}
      {editing ? null : (
        <div className="absolute top-0 right-0 hidden gap-1 rounded-md border border-neutral-800 bg-neutral-900 p-0.5 group-hover:flex">
          {QUICK_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              title={`React ${emoji}`}
              onClick={() => onReact(message.id, emoji)}
              className="rounded px-1 text-sm hover:bg-neutral-800"
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            title="Reply in thread"
            onClick={() => onReply(message)}
            className="rounded px-1.5 text-neutral-400 text-xs hover:bg-neutral-800"
          >
            thread
          </button>
          {mine && onEdit ? (
            <button
              type="button"
              title="Edit"
              onClick={() => {
                setEditDraft(contentWithoutMediaLines(message.content));
                setEditing(true);
                setConfirmingDelete(false);
              }}
              className="rounded px-1.5 text-neutral-400 text-xs hover:bg-neutral-800"
            >
              edit
            </button>
          ) : null}
          {mine && onDelete ? (
            confirmingDelete ? (
              <button
                type="button"
                title="Really delete"
                onClick={confirmDelete}
                className="rounded bg-red-900 px-1.5 text-red-200 text-xs"
              >
                sure?
              </button>
            ) : (
              <button
                type="button"
                title="Delete"
                onClick={() => setConfirmingDelete(true)}
                className="rounded px-1.5 text-neutral-400 text-xs hover:bg-neutral-800"
              >
                delete
              </button>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
