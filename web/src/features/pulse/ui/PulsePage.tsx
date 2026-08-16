import { useMemo, useState } from "react";
import { contentWithoutMediaLines } from "@/features/chat/message-media";
import { usePulse, type PulseNote } from "@/features/pulse/use-pulse";
import { AvatarDisc } from "@/features/profile/ui/AvatarDisc";
import { useNames } from "@/features/profile/use-profiles";
import { SurfaceShell } from "@/features/surfaces/ui/SurfaceShell";
import { useMembership } from "@/features/identity/use-identity";
import { cn } from "@/shared/lib/cn";

function timeOf(ts: number): string {
  const delta = Date.now() / 1000 - ts;
  if (delta < 90) {
    return "just now";
  }
  if (delta < 3600) {
    return `${Math.round(delta / 60)}m ago`;
  }
  if (delta < 86400) {
    return `${Math.round(delta / 3600)}h ago`;
  }
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function NoteCard({
  note,
  replies,
  likes,
  onLike,
  onReply,
  names,
  depth = 0,
}: {
  note: PulseNote;
  replies: Map<string, PulseNote[]>;
  likes: (id: string) => { count: number; mine: boolean };
  onLike: (id: string) => void;
  onReply: (note: PulseNote) => void;
  names: (pk: string) => string;
  depth?: number;
}) {
  const own = replies.get(note.id) ?? [];
  const like = likes(note.id);
  return (
    <div
      className={cn(
        "border-neutral-800 border-b px-4 py-3",
        depth > 0 && "ml-6 border-neutral-800/60 border-l pl-4",
      )}
    >
      <div className="flex items-center gap-2">
        <AvatarDisc pubkey={note.pubkey} name={names(note.pubkey)} size={26} />
        <span className="font-semibold text-sm">{names(note.pubkey)}</span>
        <time className="text-neutral-500 text-xs">
          {timeOf(note.createdAt)}
        </time>
        {note.pending ? (
          <span className="text-neutral-600 text-xs">sending…</span>
        ) : null}
        {note.failed ? (
          <span className="text-red-400 text-xs">not sent: {note.failed}</span>
        ) : null}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-base leading-relaxed">
        {contentWithoutMediaLines(note.content)}
      </p>
      {note.media.map((item) =>
        item.kind === "video" ? (
          // biome-ignore lint/a11y/useMediaCaption: user uploads carry no caption track
          <video
            key={item.url}
            src={item.url}
            controls
            preload="metadata"
            className="mt-2 max-h-80 max-w-md rounded-lg border border-neutral-800 bg-black"
          />
        ) : (
          <a key={item.url} href={item.url} target="_blank" rel="noreferrer">
            <img
              src={item.url}
              alt="attachment"
              className="mt-2 w-full max-w-md rounded-lg border border-neutral-800 object-contain"
              style={item.ratio ? { aspectRatio: item.ratio } : undefined}
            />
          </a>
        ),
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => onLike(note.id)}
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
            like.mine
              ? "border-amber-600 bg-amber-950 text-amber-300"
              : "border-neutral-700 text-neutral-400 hover:border-neutral-500",
          )}
        >
          🐝 {like.count > 0 ? like.count : "Like"}
        </button>
        <button
          type="button"
          onClick={() => onReply(note)}
          className="rounded-full border border-neutral-700 px-2.5 py-0.5 text-neutral-400 text-xs hover:border-neutral-500"
        >
          Reply{own.length > 0 ? ` · ${own.length}` : ""}
        </button>
      </div>
      {own.map((reply) => (
        <NoteCard
          key={reply.id}
          note={reply}
          replies={replies}
          likes={likes}
          onLike={onLike}
          onReply={onReply}
          names={names}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

export function PulsePage() {
  const { identity } = useMembership();
  const pubkey = identity?.pubkey ?? "";
  const { notes, loading, publish, likesOf, toggleLike } = usePulse(pubkey);
  const names = useNames();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<PulseNote | null>(null);
  const [busy, setBusy] = useState(false);

  const { roots, replies } = useMemo(() => {
    const byParent = new Map<string, PulseNote[]>();
    const tops: PulseNote[] = [];
    // Replies group under their parent when the parent is loaded; an orphan
    // reply (parent outside the window) is shown at top level rather than lost.
    const ids = new Set(notes.map((n) => n.id));
    for (const note of notes) {
      if (note.replyTo && ids.has(note.replyTo)) {
        const list = byParent.get(note.replyTo) ?? [];
        list.push(note);
        byParent.set(note.replyTo, list);
      } else {
        tops.push(note);
      }
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => a.createdAt - b.createdAt);
    }
    return { roots: tops, replies: byParent };
  }, [notes]);

  async function onPost() {
    const text = draft.trim();
    if (!text || busy) {
      return;
    }
    setBusy(true);
    setDraft("");
    const target = replyTo?.id;
    setReplyTo(null);
    try {
      await publish(text, target);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SurfaceShell
      title="Pulse"
      subtitle="What the Hive is up to, outside the channels"
    >
      <div className="mx-auto max-w-2xl">
        <div className="border-neutral-800 border-b px-4 py-3">
          {replyTo ? (
            <p className="mb-1 flex items-center gap-2 text-neutral-500 text-xs">
              <span className="truncate">
                Replying to {names(replyTo.pubkey)}:{" "}
                {replyTo.content.slice(0, 60)}
              </span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="shrink-0 text-neutral-400 underline"
              >
                cancel
              </button>
            </p>
          ) : null}
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder={
                replyTo ? "Write your reply" : "What are you building?"
              }
              className="min-w-0 flex-1 resize-none rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-base outline-none placeholder:text-neutral-600 focus:border-neutral-600"
            />
            <button
              type="button"
              onClick={onPost}
              disabled={busy || draft.trim().length === 0}
              className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 font-semibold text-neutral-950 text-sm disabled:opacity-40"
            >
              Post
            </button>
          </div>
        </div>

        {loading && notes.length === 0 ? (
          <p className="px-4 py-6 text-neutral-500 text-sm">
            loading the pulse…
          </p>
        ) : roots.length === 0 ? (
          <p className="px-4 py-6 text-neutral-500 text-sm">
            Nothing here yet. Say what you're building.
          </p>
        ) : (
          roots.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              replies={replies}
              likes={likesOf}
              onLike={(id) => void toggleLike(id)}
              onReply={setReplyTo}
              names={names}
            />
          ))
        )}
      </div>
    </SurfaceShell>
  );
}
