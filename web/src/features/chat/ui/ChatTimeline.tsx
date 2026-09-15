import { ProfilePreview } from "@/features/profile/ui/ProfilePreview";
import { Fragment, useMemo } from "react";
import type { ChatMessage } from "@/features/chat/use-chat";
import type { ReactionMap } from "@/features/chat/use-reactions";
import type { PresenceStatus } from "@/features/chat/use-presence";
import { topLevelOnly } from "@/features/chat/use-threads";
import { AvatarDisc } from "@/features/profile/ui/AvatarDisc";
import { MessageRow } from "./MessageRow";
import { useNames } from "@/features/profile/use-profiles";

/** Group consecutive messages from one author so the timeline reads as speech. */
function groupMessages(messages: ChatMessage[]): ChatMessage[][] {
  const groups: ChatMessage[][] = [];
  for (const message of messages) {
    const last = groups.length > 0 ? groups[groups.length - 1] : undefined;
    const sameAuthor = last !== undefined && last[0].pubkey === message.pubkey;
    // Five minutes: long enough to keep a back-and-forth together, short
    // enough that a reply hours later gets its own header.
    const close =
      last != null &&
      message.createdAt - (last[last.length - 1]?.createdAt ?? 0) < 5 * 60;
    if (
      sameAuthor &&
      close &&
      last &&
      dayOf(last[0].createdAt) === dayOf(message.createdAt)
    ) {
      last.push(message);
    } else {
      groups.push([message]);
    }
  }
  return groups;
}

function timeOf(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayOf(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** The channel timeline retains the existing message, attachment, reaction and thread controls. */
export function ChatTimeline({
  messages,
  reactions,
  pubkey,
  statusOf,
  threadIndex,
  onOpenThread,
  onReact,
  onEdit,
  onDelete,
}: {
  messages: ChatMessage[];
  reactions: ReactionMap;
  pubkey: string;
  statusOf: (pubkey: string) => PresenceStatus;
  threadIndex: Map<string, ChatMessage[]>;
  onOpenThread: (root: string) => void;
  onReact: (id: string, emoji: string) => void;
  onEdit?: (message: ChatMessage, text: string) => Promise<void>;
  onDelete: (message: ChatMessage) => Promise<void>;
}) {
  const names = useNames();
  const groups = useMemo(
    () => groupMessages(topLevelOnly(messages)),
    [messages],
  );
  const byId = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages],
  );
  return (
    <>
      {" "}
      {groups.map((group, index) => (
        <Fragment key={group[0].id}>
          {(index === 0 ||
            dayOf(groups[index - 1][0].createdAt) !==
              dayOf(group[0].createdAt)) && (
            <div className="hive-chat-date">
              <time
                dateTime={new Date(group[0].createdAt * 1000).toISOString()}
              >
                {dayOf(group[0].createdAt)}
              </time>
            </div>
          )}
          <article className="hive-message-group">
            <div className="hive-message-meta flex items-center gap-2">
              <ProfilePreview
                pubkey={group[0].pubkey}
                name={names(group[0].pubkey)}
                status={statusOf(group[0].pubkey)}
              >
                <AvatarDisc
                  pubkey={group[0].pubkey}
                  name={names(group[0].pubkey)}
                  size={30}
                />
                <span className="flex items-center gap-1.5 font-semibold text-sm">
                  {names(group[0].pubkey)}
                </span>
              </ProfilePreview>
              <time className="text-neutral-500 text-xs">
                {timeOf(group[0].createdAt)}
              </time>
            </div>
            {group.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                reactions={reactions.get(message.id) ?? []}
                selfPubkey={pubkey}
                replyPreview={
                  message.replyTo ? byId.get(message.replyTo) : undefined
                }
                replyCount={threadIndex.get(message.id)?.length ?? 0}
                onReply={(m) => onOpenThread(m.threadRoot)}
                onReact={onReact}
                onOpenThread={(m) => onOpenThread(m.threadRoot)}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </article>
        </Fragment>
      ))}{" "}
    </>
  );
}
