import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { contentWithoutMediaLines } from "@/features/chat/message-media";
import {
  type ApprovalItem,
  type InboxItem,
  useInbox,
} from "@/features/inbox/use-inbox";
import { useMembership } from "@/features/identity/use-identity";
import { AvatarDisc } from "@/features/profile/ui/AvatarDisc";
import { useNames } from "@/features/profile/use-profiles";
import { SurfaceShell } from "@/features/surfaces/ui/SurfaceShell";
import { cn } from "@/shared/lib/cn";

function when(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function MentionRow({
  item,
  names,
  onOpen,
}: {
  item: InboxItem;
  names: (pk: string) => string;
  onOpen: (item: InboxItem) => void;
}) {
  const source =
    item.kind === 1 ? "Pulse" : item.channelId ? "channel message" : "message";
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={cn(
        "flex w-full items-start gap-3 border-neutral-800 border-b px-4 py-3 text-left hover:bg-neutral-900",
        item.unread && "bg-amber-500/5",
      )}
    >
      <AvatarDisc pubkey={item.pubkey} name={names(item.pubkey)} size={30} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <b className="text-sm">{names(item.pubkey)}</b>
          <span className="text-neutral-600 text-xs">{source}</span>
          <time className="ml-auto shrink-0 text-neutral-500 text-xs">
            {when(item.createdAt)}
          </time>
        </span>
        <span className="mt-0.5 block truncate text-neutral-300 text-sm">
          {contentWithoutMediaLines(item.content) || "(attachment)"}
        </span>
      </span>
      {item.unread ? (
        <span
          className="mt-2 h-2 w-2 shrink-0 rounded-full bg-amber-400"
          role="status"
          aria-label="unread"
        />
      ) : null}
    </button>
  );
}

function ApprovalRow({
  item,
  names,
  onAnswer,
}: {
  item: ApprovalItem;
  names: (pk: string) => string;
  onAnswer: (item: ApprovalItem, grant: boolean) => void;
}) {
  return (
    <div className="border-neutral-800 border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <AvatarDisc pubkey={item.pubkey} name={names(item.pubkey)} size={26} />
        <b className="text-sm">{names(item.pubkey)}</b>
        <span className="text-neutral-600 text-xs">asks for approval</span>
        <time className="ml-auto text-neutral-500 text-xs">
          {when(item.createdAt)}
        </time>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-neutral-300 text-sm">
        {item.content || "A workflow is waiting on your sign-off."}
      </p>
      <div className="mt-2 flex gap-2">
        {item.resolved ? (
          <span
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs",
              item.resolved === "granted"
                ? "border-emerald-700 text-emerald-400"
                : "border-red-800 text-red-400",
            )}
          >
            {item.resolved}
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onAnswer(item, true)}
              className="rounded-lg bg-amber-500 px-3 py-1 font-semibold text-neutral-950 text-xs"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => onAnswer(item, false)}
              className="rounded-lg border border-neutral-700 px-3 py-1 text-neutral-300 text-xs"
            >
              Deny
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function InboxPage() {
  const { identity } = useMembership();
  const pubkey = identity?.pubkey ?? "";
  const {
    items,
    approvals,
    loading,
    unreadCount,
    markAllRead,
    answerApproval,
  } = useInbox(pubkey);
  const names = useNames();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  function openItem(item: InboxItem) {
    if (item.kind === 1) {
      void navigate({ to: "/pulse" });
      return;
    }
    if (item.channelId) {
      void navigate({ to: "/chat", search: { channel: item.channelId } });
    }
  }

  async function onAnswer(item: ApprovalItem, grant: boolean) {
    setError(null);
    const failure = await answerApproval(item, grant);
    if (failure) {
      setError(failure);
    }
  }

  return (
    <SurfaceShell
      title="Inbox"
      subtitle="Mentions, replies, and things waiting on you"
      action={
        <button
          type="button"
          onClick={markAllRead}
          disabled={unreadCount === 0}
          className="shrink-0 rounded-lg border border-neutral-700 px-2.5 py-1.5 text-neutral-300 text-sm hover:border-neutral-500 disabled:opacity-40"
        >
          Mark all read
        </button>
      }
    >
      <div className="mx-auto max-w-2xl">
        {error ? (
          <p className="px-4 pt-3 text-red-400 text-sm" role="alert">
            {error}
          </p>
        ) : null}

        {approvals.length > 0 ? (
          <section>
            <h2 className="px-4 pt-4 pb-1 font-semibold text-neutral-500 text-xs uppercase tracking-wide">
              Needs action
            </h2>
            {approvals.map((item) => (
              <ApprovalRow
                key={item.id}
                item={item}
                names={names}
                onAnswer={(a, g) => void onAnswer(a, g)}
              />
            ))}
          </section>
        ) : null}

        <h2 className="px-4 pt-4 pb-1 font-semibold text-neutral-500 text-xs uppercase tracking-wide">
          Mentions &amp; messages
        </h2>
        {loading && items.length === 0 ? (
          <p className="px-4 py-6 text-neutral-500 text-sm">checking…</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-neutral-500 text-sm">
            Nothing addressed to you yet. Mentions and DM messages land here.
          </p>
        ) : (
          items.map((item) => (
            <MentionRow
              key={item.id}
              item={item}
              names={names}
              onOpen={openItem}
            />
          ))
        )}
      </div>
    </SurfaceShell>
  );
}
