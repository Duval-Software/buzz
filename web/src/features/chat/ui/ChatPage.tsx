import { useEffect, useMemo, useRef, useState } from "react";
import {
  type Channel,
  type ChatMessage,
  useChannels,
  useMessages,
  useRelayState,
} from "@/features/chat/use-chat";
import { MessageRow } from "@/features/chat/ui/MessageRow";
import { VideoPanel } from "@/features/video/ui/VideoPanel";
import { stageBaseUrl } from "@/features/video/stage-client";
import { LiveRooms } from "@/features/video/ui/LiveRooms";
import { StageWatch } from "@/features/video/ui/StageWatch";
import { PresenceDot } from "@/features/chat/ui/PresenceDot";
import { ThreadPanel } from "@/features/chat/ui/ThreadPanel";
import {
  buildThread,
  topLevelOnly,
  useThreadIndex,
} from "@/features/chat/use-threads";
import { usePresence } from "@/features/chat/use-presence";
import { useReactions, useTyping } from "@/features/chat/use-reactions";
import { uploadImage, type UploadedMedia } from "@/features/chat/upload";
import { useUnread } from "@/features/chat/use-unread";
import { AvatarDisc } from "@/features/profile/ui/AvatarDisc";
import { SearchPanel } from "@/features/search/ui/SearchPanel";
import { NewDmPicker } from "@/features/dm/ui/NewDmPicker";
import { MembersPanel } from "@/features/members/ui/MembersPanel";
import { useInboxUnread } from "@/features/inbox/use-inbox";
import { SurfacesNav } from "@/features/surfaces/ui/SurfacesNav";
import { useSearch } from "@tanstack/react-router";
import {
  MentionPopup,
  useMentionCandidates,
  type MentionCandidate,
} from "@/features/chat/ui/MentionPopup";
import { useMembers } from "@/features/members/use-members";
import { useNames } from "@/features/profile/use-profiles";
import { IdentityPanel } from "@/features/identity/ui/IdentityPanel";
import { useMembership } from "@/features/identity/use-identity";
import { cn } from "@/shared/lib/cn";

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
    if (sameAuthor && close && last) {
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

function ConnectionPill() {
  const state = useRelayState();
  const label =
    state === "ready"
      ? "connected"
      : state === "offline"
        ? "reconnecting"
        : "connecting";
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs",
        state === "ready"
          ? "border-emerald-700 text-emerald-400"
          : "border-amber-700 text-amber-400",
      )}
    >
      {label}
    </span>
  );
}

export function ChatPage() {
  // Read the identity, never create one. This page used to call
  // loadOrCreateIdentity, which quietly minted a key during render — including
  // in the instant after a sign-out, so signing out immediately signed you back
  // in as somebody new. Creating an identity is the join flow's job alone.
  const { identity, signOut } = useMembership();
  const [identityOpen, setIdentityOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dmPickerOpen, setDmPickerOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [watchingRoom, setWatchingRoom] = useState<string | null>(null);
  const { channels, loading: channelsLoading } = useChannels();
  const [activeId, setActiveId] = useState<string | null>(null);
  const { messages, loading, send, editMessage, deleteMessage } =
    useMessages(activeId);
  const [draft, setDraft] = useState("");
  // The names picked from the popup this draft, so send() can attach `p`
  // tags for exactly the mentions still present in the final text.
  const draftMentions = useRef<Map<string, string>>(new Map());
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const composerRef = useRef<HTMLInputElement>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<UploadedMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openThreadRoot, setOpenThreadRoot] = useState<string | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const videoConfigured = stageBaseUrl() !== null;
  const channelIds = useMemo(() => channels.map((c) => c.id), [channels]);
  // Hooks cannot be skipped, so a signed-out render passes an empty pubkey for
  // the one frame before the gate swaps this page out. It only ever means
  // "none of these are mine", which is true.
  const pubkey = identity?.pubkey ?? "";
  const { reactions, toggle } = useReactions(activeId, pubkey);
  const { typists, noteTyping } = useTyping(activeId, pubkey);
  const { unread } = useUnread(channelIds, activeId, pubkey);
  const { onlineCount, statusOf } = usePresence(pubkey);
  const inboxUnread = useInboxUnread(pubkey);
  const search = useSearch({ from: "/chat" });
  const names = useNames();
  const members = useMembers(membersOpen ? activeId : null);
  const mentionCandidates = useMentionCandidates(pubkey, mentionQuery);
  const threadIndex = useThreadIndex(messages);
  const openThread = buildThread(openThreadRoot, messages, threadIndex);
  const byId = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages],
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  // Open the first channel once the list arrives, so the app is never a blank
  // screen waiting for a click. A ?channel= deep link (inbox, agents) wins
  // over the default, and re-navigating while mounted switches channels.
  const wantedChannel = search.channel;
  useEffect(() => {
    if (wantedChannel && channels.some((c) => c.id === wantedChannel)) {
      setActiveId(wantedChannel);
      return;
    }
    if (!activeId && channels.length > 0) {
      setActiveId(channels[0].id);
    }
  }, [channels, activeId, wantedChannel]);

  // Follow the conversation on a NEW message, keyed by its id rather than the
  // array identity: that both satisfies the deps rule honestly and avoids
  // yanking the view on unrelated re-renders.
  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (!lastMessageId) {
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastMessageId]);

  // A reply target from another channel would silently thread into the wrong
  // place, so drop it when the channel changes.
  useEffect(() => {
    setOpenThreadRoot(null);
    setVideoOpen(false);
  }, []);

  // Deep links: /chat?room=<name> opens that room's watch panel directly.
  // This is what lets a go-live announcement in chat land INSIDE the app
  // instead of bouncing people out to the standalone stage page. The name is
  // validated against the same pattern stagekeeper enforces, so a crafted URL
  // cannot inject anything stranger than a room that does not exist.
  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get("room");
    if (room && /^[a-z0-9][a-z0-9-]{0,62}$/.test(room)) {
      setWatchingRoom(room);
    }
  }, []);

  const active = channels.find((c) => c.id === activeId);
  const regularChannels = channels.filter((c) => c.kind === "channel");
  const dmChannels = channels.filter((c) => c.kind === "dm");
  const dmLabel = (c: Channel) =>
    c.participants
      .filter((p) => p !== pubkey.toLowerCase())
      .map((p) => names(p))
      .join(", ") || "just you";
  const groups = useMemo(
    () => groupMessages(topLevelOnly(messages)),
    [messages],
  );
  // With the channel list hidden behind a drawer, the per-channel badges are
  // out of sight. Carry the total onto the button that opens it, or unread
  // messages become invisible on a phone.
  const totalUnread = useMemo(
    () => [...unread.values()].reduce((sum, n) => sum + n, 0),
    [unread],
  );

  // Signed out. The gate is already replacing this page; render nothing rather
  // than a chat window belonging to nobody.
  if (!identity) {
    return null;
  }

  /** The `@` the caret is completing, or null when it is not in one. */
  function mentionAnchor(
    value: string,
    caret: number,
  ): { at: number; query: string } | null {
    const upToCaret = value.slice(0, caret);
    const at = upToCaret.lastIndexOf("@");
    if (at < 0 || (at > 0 && !/\s/.test(upToCaret[at - 1]))) {
      return null;
    }
    const query = upToCaret.slice(at + 1);
    if (query.length > 24 || query.includes("@") || query.includes("\n")) {
      return null;
    }
    return { at, query };
  }

  function onComposerChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setDraft(value);
    noteTyping();
    const anchor = mentionAnchor(
      value,
      event.target.selectionStart ?? value.length,
    );
    setMentionQuery(anchor ? anchor.query : null);
    setMentionIndex(0);
  }

  function pickMention(candidate: MentionCandidate) {
    const input = composerRef.current;
    const caret = input?.selectionStart ?? draft.length;
    const anchor = mentionAnchor(draft, caret);
    if (!anchor) {
      return;
    }
    const inserted = `@${candidate.name} `;
    const next = draft.slice(0, anchor.at) + inserted + draft.slice(caret);
    draftMentions.current.set(candidate.name, candidate.pubkey);
    setDraft(next);
    setMentionQuery(null);
    // Put the caret after the inserted mention once React has re-rendered.
    const position = anchor.at + inserted.length;
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(position, position);
    });
  }

  function outgoingMentions(text: string): string[] {
    // Only names still present count: picking a name and then deleting it
    // must not notify anyone. DM messages address every other participant
    // regardless — agent harnesses and phone notifications key on the tags.
    const explicit = [...draftMentions.current.entries()]
      .filter(([name]) => text.includes(`@${name}`))
      .map(([, mentioned]) => mentioned);
    const recipients = active?.kind === "dm" ? active.participants : [];
    return [...explicit, ...recipients];
  }

  async function onSend(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text && !attachment) {
      return;
    }
    setDraft("");
    setSendError(null);
    setMentionQuery(null);
    const media = attachment;
    setAttachment(null);
    const mentions = outgoingMentions(text);
    draftMentions.current.clear();
    try {
      await send(text, undefined, media ? [media] : undefined, mentions);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "could not send");
    }
  }

  async function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Same input can pick the same file twice in a row.
    event.target.value = "";
    if (!file) {
      return;
    }
    setUploading(true);
    setSendError(null);
    try {
      setAttachment(await uploadImage(file));
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : "could not upload");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex h-dvh bg-neutral-950 text-neutral-100">
      {/*
        On a phone the channel list is a drawer, not a column: 240px of
        permanent sidebar on a 375px screen leaves the conversation in a
        gutter. Above `md` it is the plain two-column layout again.
      */}
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close channel list"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      ) : null}

      <aside
        className={cn(
          "z-40 flex w-60 shrink-0 flex-col border-neutral-800 border-r bg-neutral-950",
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:transition-transform",
          drawerOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-neutral-800 border-b px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <span className="flex items-center gap-2 font-semibold text-sm">
            Channels
            {onlineCount > 0 ? (
              <span
                className="font-normal text-neutral-500 text-xs"
                title="People active in the last few minutes"
              >
                {onlineCount} online
              </span>
            ) : null}
          </span>
          <ConnectionPill />
        </div>
        <SurfacesNav inboxUnread={inboxUnread} />
        <nav className="flex-1 overflow-y-auto p-2">
          {channelsLoading && channels.length === 0 ? (
            <p className="px-2 py-1 text-neutral-500 text-sm">loading…</p>
          ) : channels.length === 0 ? (
            <p className="px-2 py-1 text-neutral-500 text-sm">
              No channels visible to this key yet.
            </p>
          ) : (
            regularChannels.map((channel) => (
              <button
                key={channel.id}
                type="button"
                onClick={() => {
                  setActiveId(channel.id);
                  // Picking a channel is the reason the drawer was opened, so
                  // get it out of the way instead of making them dismiss it.
                  setDrawerOpen(false);
                }}
                className={cn(
                  "w-full truncate rounded px-2 py-2.5 text-left text-sm md:py-1.5",
                  channel.id === activeId
                    ? "bg-neutral-800 text-neutral-50"
                    : "text-neutral-400 hover:bg-neutral-900",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    <span className="text-neutral-600">#</span> {channel.name}
                  </span>
                  {(unread.get(channel.id) ?? 0) > 0 ? (
                    <span className="shrink-0 rounded-full bg-amber-500 px-1.5 text-xs text-neutral-950">
                      {unread.get(channel.id)}
                    </span>
                  ) : null}
                </span>
              </button>
            ))
          )}
          <div className="mt-3 flex items-center justify-between px-2">
            <span className="text-neutral-500 text-xs">Direct messages</span>
            <button
              type="button"
              aria-label="New message"
              onClick={() => setDmPickerOpen(true)}
              className="rounded border border-neutral-700 px-1.5 text-neutral-400 text-xs hover:text-neutral-200"
            >
              +
            </button>
          </div>
          {dmChannels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              onClick={() => {
                setActiveId(channel.id);
                setDrawerOpen(false);
              }}
              className={cn(
                "w-full truncate rounded px-2 py-2.5 text-left text-sm md:py-1.5",
                channel.id === activeId
                  ? "bg-neutral-800 text-neutral-50"
                  : "text-neutral-400 hover:bg-neutral-900",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">{dmLabel(channel)}</span>
                {(unread.get(channel.id) ?? 0) > 0 ? (
                  <span className="shrink-0 rounded-full bg-amber-500 px-1.5 text-neutral-950 text-xs">
                    {unread.get(channel.id)}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </nav>
        {videoConfigured ? (
          <LiveRooms
            selfPubkey={pubkey}
            activeRoom={watchingRoom}
            onOpen={(room) => {
              setWatchingRoom(room);
              setOpenThreadRoot(null);
              setDrawerOpen(false);
            }}
          />
        ) : null}
        <button
          type="button"
          onClick={() => setIdentityOpen(true)}
          className="border-neutral-800 border-t px-4 py-3 text-left text-neutral-500 text-xs hover:text-neutral-300"
        >
          you: {names(identity.pubkey)}
          <span className="ml-1 text-neutral-600">· identity</span>
        </button>
      </aside>

      {dmPickerOpen ? (
        <NewDmPicker
          selfPubkey={pubkey}
          onOpened={(id) => setActiveId(id)}
          onClose={() => setDmPickerOpen(false)}
        />
      ) : null}

      {searchOpen ? (
        <SearchPanel
          channels={channels}
          onOpenChannel={(id) => setActiveId(id)}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}

      {identityOpen ? (
        <IdentityPanel
          identity={identity}
          onClose={() => setIdentityOpen(false)}
          onSignOut={signOut}
        />
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-start justify-between gap-2 border-neutral-800 border-b px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-5">
          <button
            type="button"
            aria-label="Channels"
            onClick={() => setDrawerOpen(true)}
            className="relative shrink-0 rounded-lg border border-neutral-700 px-2.5 py-1.5 text-neutral-300 md:hidden"
          >
            ☰
            {totalUnread > 0 ? (
              <span className="-right-1 -top-1 absolute rounded-full bg-amber-500 px-1.5 text-neutral-950 text-xs">
                {totalUnread}
              </span>
            ) : null}
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold text-base">
              {active
                ? active.kind === "dm"
                  ? dmLabel(active)
                  : `#${active.name}`
                : "Select a channel"}
            </h1>
            {active?.about ? (
              <p className="truncate text-neutral-500 text-sm max-md:hidden">
                {active.about}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Members"
            onClick={() => setMembersOpen((open) => !open)}
            className="shrink-0 rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300 text-sm hover:border-neutral-500"
          >
            👥
          </button>
          <button
            type="button"
            aria-label="Search"
            onClick={() => setSearchOpen(true)}
            className="shrink-0 rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300 text-sm hover:border-neutral-500"
          >
            🔎
          </button>
          {active && active.kind !== "dm" && videoConfigured ? (
            <button
              type="button"
              onClick={() => setVideoOpen((open) => !open)}
              className={cn(
                "shrink-0 rounded-lg border px-3 py-1.5 text-sm",
                videoOpen
                  ? "border-amber-600 bg-amber-950 text-amber-300"
                  : "border-neutral-700 text-neutral-300 hover:border-neutral-500",
              )}
            >
              {videoOpen ? "Hide video" : "Video"}
            </button>
          ) : null}
        </header>

        {active && videoOpen ? (
          <VideoPanel
            key={active.id}
            channelId={active.id}
            channelName={active.name}
          />
        ) : null}

        <div className="flex-1 overflow-y-auto px-3 py-4 md:px-5">
          {loading && messages.length === 0 ? (
            <p className="text-neutral-500 text-sm">loading messages…</p>
          ) : messages.length === 0 ? (
            <p className="text-neutral-500 text-sm">
              No messages here yet. Say something.
            </p>
          ) : (
            groups.map((group) => (
              <article key={group[0].id} className="mb-4">
                <div className="mb-1 flex items-center gap-2">
                  <AvatarDisc
                    pubkey={group[0].pubkey}
                    name={names(group[0].pubkey)}
                    size={22}
                  />
                  <span className="flex items-center gap-1.5 font-semibold text-sm">
                    <PresenceDot status={statusOf(group[0].pubkey)} />
                    {names(group[0].pubkey)}
                  </span>
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
                    onReply={(m) => setOpenThreadRoot(m.threadRoot)}
                    onReact={toggle}
                    onOpenThread={(m) => setOpenThreadRoot(m.threadRoot)}
                    onEdit={editMessage}
                    onDelete={deleteMessage}
                  />
                ))}
              </article>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/*
          The bottom inset keeps the composer clear of the home indicator on a
          phone; without it the send button sits under the swipe bar.
        */}
        <form
          onSubmit={onSend}
          className="border-neutral-800 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          {typists.length > 0 ? (
            <p className="mb-1 text-neutral-500 text-xs">
              {typists.length === 1
                ? `${names(typists[0])} is typing…`
                : `${typists.length} people are typing…`}
            </p>
          ) : null}

          {sendError ? (
            <p className="mb-2 text-red-400 text-sm">{sendError}</p>
          ) : null}
          {attachment ? (
            <div className="mb-2 flex items-center gap-2 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs">
              <img
                src={attachment.url}
                alt="ready to send"
                className="h-8 w-8 rounded object-cover"
              />
              <span className="truncate text-neutral-400">image attached</span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="ml-auto shrink-0 text-neutral-500 hover:text-neutral-300"
              >
                remove
              </button>
            </div>
          ) : null}
          <div className="relative flex items-center gap-2">
            <MentionPopup
              candidates={mentionCandidates}
              selectedIndex={mentionIndex}
              onPick={pickMention}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onPickFile}
              className="hidden"
            />
            <button
              type="button"
              aria-label="Attach an image"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || !activeId}
              className="shrink-0 rounded-lg border border-neutral-700 px-2.5 py-2 text-neutral-300 text-sm disabled:opacity-50"
            >
              {uploading ? "…" : "📎"}
            </button>
            <input
              ref={composerRef}
              value={draft}
              onChange={onComposerChange}
              onKeyDown={(event) => {
                if (mentionCandidates.length === 0) {
                  return;
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setMentionIndex(
                    (current) =>
                      (current + step + mentionCandidates.length) %
                      mentionCandidates.length,
                  );
                } else if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  pickMention(mentionCandidates[mentionIndex]);
                } else if (event.key === "Escape") {
                  setMentionQuery(null);
                }
              }}
              disabled={!activeId}
              placeholder={
                active ? `Message #${active.name}` : "Select a channel"
              }
              className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-base outline-none placeholder:text-neutral-600 focus:border-neutral-600"
            />
            {/*
              A phone has no Enter key worth relying on, so sending needs
              something to tap. It also takes Enter off the single-field
              implicit-submission rule, which is the fiddliest corner of form
              behaviour and varies by engine. Cheap insurance either way.
            */}
            <button
              type="submit"
              disabled={!activeId || (draft.trim().length === 0 && !attachment)}
              className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 font-semibold text-neutral-950 text-sm disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </form>
      </main>

      {membersOpen && !watchingRoom ? (
        <MembersPanel
          members={members}
          statusOf={statusOf}
          onClose={() => setMembersOpen(false)}
        />
      ) : null}

      {watchingRoom ? (
        <StageWatch
          key={watchingRoom}
          room={watchingRoom}
          selfPubkey={pubkey}
          onClose={() => setWatchingRoom(null)}
        />
      ) : openThread && !membersOpen ? (
        <ThreadPanel
          thread={openThread}
          statusOf={statusOf}
          onClose={() => setOpenThreadRoot(null)}
          onSend={(text, target) =>
            send(
              text,
              { rootId: openThread.root.id, parentId: target.id },
              undefined,
              active?.kind === "dm" ? active.participants : [],
            )
          }
        />
      ) : null}
    </div>
  );
}
