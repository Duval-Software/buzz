import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/features/chat/use-chat";
import { PresenceDot } from "@/features/chat/ui/PresenceDot";
import type { PresenceStatus } from "@/features/chat/use-presence";
import type { Thread } from "@/features/chat/use-threads";
import { useNames } from "@/features/profile/use-profiles";

function timeOf(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * One thread, beside the channel.
 *
 * The composer here always replies into this thread, which is the point: in
 * the main timeline you have to remember to hit reply, and a mis-aimed reply
 * silently starts a second conversation. Here there is nowhere else for a
 * message to go.
 *
 * On a phone it takes the whole screen instead of squeezing beside the
 * timeline — a 375px screen split two ways is two unusable columns.
 */
export function ThreadPanel({
  thread,
  statusOf,
  onClose,
  onSend,
}: {
  thread: Thread;
  statusOf: (pubkey: string) => PresenceStatus;
  onClose: () => void;
  onSend: (text: string, target: ChatMessage) => Promise<void>;
}) {
  const names = useNames();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastReplyId = thread.replies[thread.replies.length - 1]?.id;

  useEffect(() => {
    // Jump straight to the bottom when the panel opens, and glide for replies
    // that arrive while it is open — animating the initial position just looks
    // like the panel is still loading.
    bottomRef.current?.scrollIntoView({
      behavior: lastReplyId ? "smooth" : "auto",
    });
  }, [lastReplyId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) {
      return;
    }
    setDraft("");
    setError(null);
    setSending(true);
    try {
      // Reply to the LAST message in the thread, not the root: that keeps the
      // parent chain meaningful for clients that render nesting, while the
      // root tag keeps everything in one thread either way.
      const target = thread.replies[thread.replies.length - 1] ?? thread.root;
      await onSend(text, target);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "could not send");
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <aside className="flex w-full shrink-0 flex-col border-neutral-800 bg-neutral-950 max-md:fixed max-md:inset-0 max-md:z-40 md:w-96 md:border-l">
      <header className="flex items-center justify-between gap-2 border-neutral-800 border-b px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <h2 className="font-semibold text-sm">Thread</h2>
          <p className="text-neutral-500 text-xs">
            {thread.replies.length === 0
              ? "No replies yet"
              : `${thread.replies.length} ${thread.replies.length === 1 ? "reply" : "replies"} · ${thread.participants.length} ${thread.participants.length === 1 ? "person" : "people"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-neutral-700 px-2.5 py-1.5 text-neutral-300 text-sm"
        >
          Close
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <article className="border-neutral-800 border-b pb-3">
          <div className="mb-1 flex items-baseline gap-2">
            <span className="flex items-center gap-1.5 font-semibold text-sm">
              <PresenceDot status={statusOf(thread.root.pubkey)} />
              {names(thread.root.pubkey)}
            </span>
            <time className="text-neutral-500 text-xs">
              {timeOf(thread.root.createdAt)}
            </time>
          </div>
          <p className="whitespace-pre-wrap break-words text-base leading-relaxed">
            {thread.root.content}
          </p>
        </article>

        {thread.replies.map((reply) => (
          <article key={reply.id} className="mt-3">
            <div className="mb-1 flex items-baseline gap-2">
              <span className="flex items-center gap-1.5 font-semibold text-sm">
                <PresenceDot status={statusOf(reply.pubkey)} />
                {names(reply.pubkey)}
              </span>
              <time className="text-neutral-500 text-xs">
                {timeOf(reply.createdAt)}
              </time>
            </div>
            <p
              className={
                reply.pending
                  ? "whitespace-pre-wrap break-words text-base text-neutral-500 leading-relaxed"
                  : "whitespace-pre-wrap break-words text-base leading-relaxed"
              }
            >
              {reply.content}
            </p>
          </article>
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={submit}
        className="border-neutral-800 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {error ? <p className="mb-2 text-red-400 text-sm">{error}</p> : null}
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Reply in thread"
            className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-base outline-none placeholder:text-neutral-600 focus:border-neutral-600"
          />
          <button
            type="submit"
            disabled={draft.trim().length === 0 || sending}
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 font-semibold text-neutral-950 text-sm disabled:opacity-40"
          >
            Reply
          </button>
        </div>
      </form>
    </aside>
  );
}
