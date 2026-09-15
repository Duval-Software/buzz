import { useState } from "react";
import type { ChatMessage } from "@/features/chat/use-chat";
import type { ReactionSummary } from "@/features/chat/use-reactions";
import {
  contentWithoutMediaLines,
  mediaLinesOf,
} from "@/features/chat/message-media";
import {
  MessageContent,
  MessageAttachments,
} from "@/features/chat/ui/MessageContent";
import { useNames } from "@/features/profile/use-profiles";
import { cn } from "@/shared/lib/cn";
import { ReportMessage } from "@/features/moderation/ReportMessage";

/** The quick-reaction set. Anything else can still arrive from other clients. */
const QUICK_EMOJI = ["👍", "🎉", "👀", "🐝"];

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
  // Animate a local send once, without replaying when its relay receipt arrives.
  const [outgoing] = useState(() => Boolean(message.pending));
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
      data-message-id={message.id}
      tabIndex={-1}
      className={cn(
        "hive-message group relative",
        outgoing && !message.failed && "is-outgoing",
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
            aria-label="Edit message"
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
            "min-w-0 break-words text-base leading-relaxed",
            message.pending && "text-neutral-500",
            message.failed && "text-red-400",
          )}
        >
          <MessageContent message={message} selfPubkey={selfPubkey} />
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

      <MessageAttachments message={message} />

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
        <div className="hive-message-actions">
          {QUICK_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              title={`React ${emoji}`}
              aria-label={`React ${emoji}`}
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
          {!mine && !message.pending && !message.failed && (
            <ReportMessage
              id={message.id}
              author={message.pubkey}
              content={message.content}
            />
          )}
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
