import {
  CommunityShell,
  findAnnouncementChannel,
} from "@/features/surfaces/ui/CommunityShell";
import {
  Menu,
  Megaphone,
  Users,
  Search,
  Video,
  Paperclip,
  Mic,
  ArrowUp,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type Channel,
  useChannels,
  useMessages,
} from "@/features/chat/use-chat";
import { ChatTimeline } from "./ChatTimeline";
import { ChatContext } from "./ChatContext";
import { useCommunityMembers } from "@/features/community/community-access";

import { stageBaseUrl } from "@/features/video/stage-client";

import { ThreadPanel } from "@/features/chat/ui/ThreadPanel";
import { buildThread, useThreadIndex } from "@/features/chat/use-threads";
import { usePresence } from "@/features/chat/use-presence";
import { useReactions, useTyping } from "@/features/chat/use-reactions";
import { uploadImage, type UploadedMedia } from "@/features/chat/upload";
import { useVoiceRecorder } from "@/features/chat/use-voice-recorder";
import {
  formatVoiceNoteDuration,
  prepareVoiceNote,
  VOICE_NOTE_MAX_DURATION_SECONDS,
} from "@/features/chat/voice-note";
import { MembersPanel } from "@/features/members/ui/MembersPanel";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  MentionPopup,
  useMentionCandidates,
  type MentionCandidate,
} from "@/features/chat/ui/MentionPopup";
import { useMembers } from "@/features/members/use-members";
import { useNames } from "@/features/profile/use-profiles";
import { useMembership } from "@/features/identity/use-identity";
import { cn } from "@/shared/lib/cn";

const VideoPanel = lazy(() =>
  import("@/features/video/ui/VideoPanel").then((module) => ({
    default: module.VideoPanel,
  })),
);
const StageWatch = lazy(() =>
  import("@/features/video/ui/StageWatch").then((module) => ({
    default: module.StageWatch,
  })),
);

export function ChatPage() {
  // Read the identity, never create one. This page used to call
  // loadOrCreateIdentity, which quietly minted a key during render — including
  // in the instant after a sign-out, so signing out immediately signed you back
  // in as somebody new. Creating an identity is the join flow's job alone.
  const { identity } = useMembership();
  const [membersOpen, setMembersOpen] = useState(false);
  useEffect(() => {
    function dismiss(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMembersOpen(false);
        setOpenThreadRoot(null);
      }
    }
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, []);
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
  const recorder = useVoiceRecorder();
  // Stop-and-send when a recording hits the cap. Narrow deps on purpose:
  // onVoiceSend is recreated per render, and the status guard prevents
  // re-entry once the stop begins.
  // biome-ignore lint/correctness/useExhaustiveDependencies: narrow deps by design
  useEffect(() => {
    if (
      recorder.status === "recording" &&
      recorder.elapsedSeconds >= VOICE_NOTE_MAX_DURATION_SECONDS
    ) {
      void onVoiceSend();
    }
  }, [recorder.status, recorder.elapsedSeconds]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openThreadRoot, setOpenThreadRoot] = useState<string | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const videoConfigured = stageBaseUrl() !== null;
  // Hooks cannot be skipped, so a signed-out render passes an empty pubkey for
  // the one frame before the gate swaps this page out. It only ever means
  // "none of these are mine", which is true.
  const pubkey = identity?.pubkey ?? "";
  const { reactions, toggle } = useReactions(activeId, pubkey);
  const { typists, noteTyping } = useTyping(activeId, pubkey);
  const { onlineCount, statusOf } = usePresence(pubkey);
  const search = useSearch({ from: "/chat" });
  const navigate = useNavigate();
  const names = useNames();
  const members = useMembers(activeId);
  const communityMembers = useCommunityMembers();
  const channelRole = members.find((member) => member.pubkey === pubkey)?.role;
  const mentionCandidates = useMentionCandidates(pubkey, mentionQuery);
  const threadIndex = useThreadIndex(messages);
  const openThread = buildThread(openThreadRoot, messages, threadIndex);
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);

  // Open the first channel once the list arrives, so the app is never a blank
  // screen waiting for a click. A ?channel= deep link (inbox, agents) wins
  // over the default, and re-navigating while mounted switches channels.
  const announcementChannel = findAnnouncementChannel(channels);
  const announcementsOpen = search.view === "announcements";
  const wantedChannel = search.channel;
  useEffect(() => {
    if (announcementsOpen) {
      setActiveId(announcementChannel?.id ?? null);
      return;
    }
    if (wantedChannel && channels.some((c) => c.id === wantedChannel)) {
      setActiveId(wantedChannel);
      return;
    }
    if (!activeId && channels.length > 0) {
      setActiveId(channels[0].id);
    }
  }, [
    channels,
    activeId,
    wantedChannel,
    announcementsOpen,
    announcementChannel?.id,
  ]);

  // History arrives in batches, and media can change height after messages render.
  // Follow the content's actual size until the member scrolls up to read history.
  useLayoutEffect(() => {
    if (!activeId) return;
    const timeline = timelineRef.current;
    const content = timelineContentRef.current;
    if (!timeline || !content) return;
    followLatest.current = true;
    let previousTop = timeline.scrollTop;
    const follow = () => {
      if (followLatest.current) {
        timeline.scrollTop = timeline.scrollHeight;
        previousTop = timeline.scrollTop;
      }
    };
    const onScroll = () => {
      const atBottom =
        timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop < 64;
      if (atBottom) followLatest.current = true;
      // Media growth can move the bottom without the member scrolling up.
      else if (timeline.scrollTop < previousTop) followLatest.current = false;
      previousTop = timeline.scrollTop;
    };
    follow();
    timeline.addEventListener("scroll", onScroll);
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    observer.observe(timeline);
    return () => {
      observer.disconnect();
      timeline.removeEventListener("scroll", onScroll);
    };
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    setOpenThreadRoot(null);
    setVideoOpen(false);
  }, [activeId]);

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
  const canPublish =
    active?.postingPolicy !== "admins" ||
    channelRole === "owner" ||
    channelRole === "admin";
  const dmLabel = (c: Channel) =>
    c.participants
      .filter((p) => p !== pubkey.toLowerCase())
      .map((p) => names(p))
      .join(", ") || "just you";
  // Signed out. The gate is already replacing this page; render nothing rather
  // than a chat window belonging to nobody.
  if (!identity) {
    return null;
  }

  function selectChannel(id: string) {
    setActiveId(id);
    void navigate({
      to: "/chat",
      search: { ...search, view: undefined, channel: id },
    });
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

  async function onVoiceSend() {
    const take = await recorder.stop();
    if (!take) {
      return;
    }
    setUploading(true);
    setSendError(null);
    try {
      const media = await prepareVoiceNote(take.wav, take.duration);
      await send("", undefined, [media]);
    } catch (cause) {
      setSendError(
        cause instanceof Error
          ? cause.message
          : "could not send the voice note",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <CommunityShell
      channels={channels}
      channelsLoading={channelsLoading}
      activeId={activeId}
      announcementsOpen={announcementsOpen}
      activeRoom={watchingRoom}
      onSelectChannel={selectChannel}
      onOpenRoom={(room) => {
        setWatchingRoom(room);
        setOpenThreadRoot(null);
      }}
    >
      {({ openChannels, openSearch, drawerOpen, totalUnread }) => (
        <div className="hive-chat-body">
          <main className="flex min-w-0 flex-1 flex-col">
            <header className="hive-chat-header flex items-start justify-between gap-2 border-neutral-800 border-b px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-5">
              <button
                type="button"
                aria-label="Channels"
                aria-expanded={drawerOpen}
                aria-controls="channel-navigation"
                onClick={openChannels}
                className="hive-mobile-trigger relative shrink-0 rounded-lg border border-neutral-700 px-2.5 py-1.5 text-neutral-300 md:hidden"
              >
                <Menu size={20} aria-hidden="true" />
                {totalUnread > 0 ? (
                  <span className="-right-1 -top-1 absolute rounded-full bg-amber-500 px-1.5 text-neutral-950 text-xs">
                    {totalUnread}
                  </span>
                ) : null}
              </button>
              <div className="min-w-0 flex-1">
                <h1 className="truncate font-semibold text-base">
                  {active?.postingPolicy === "admins" ? (
                    <>
                      <span className="sr-only">Announcement channel </span>
                      <Megaphone
                        size={16}
                        className="inline mr-2"
                        aria-hidden="true"
                      />
                    </>
                  ) : null}
                  {active
                    ? active.kind === "dm"
                      ? dmLabel(active)
                      : `#${active.name}`
                    : announcementsOpen
                      ? "Announcements"
                      : "Select a channel"}
                </h1>
              </div>
              <button
                type="button"
                aria-label="Members"
                aria-pressed={membersOpen}
                onClick={() => setMembersOpen((open) => !open)}
                className="shrink-0 rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300 text-sm hover:border-neutral-500"
              >
                <Users size={19} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Search"
                onClick={openSearch}
                className="shrink-0 rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300 text-sm hover:border-neutral-500"
              >
                <Search size={19} aria-hidden="true" />
              </button>
              {active && active.kind !== "dm" && videoConfigured ? (
                <button
                  type="button"
                  aria-label={videoOpen ? "Hide video" : "Video"}
                  onClick={() => setVideoOpen((open) => !open)}
                  className={cn(
                    "shrink-0 rounded-lg border px-3 py-1.5 text-sm",
                    videoOpen
                      ? "border-amber-600 bg-amber-950 text-amber-300"
                      : "border-neutral-700 text-neutral-300 hover:border-neutral-500",
                  )}
                >
                  <Video size={18} aria-hidden="true" />
                  <span className="hive-desktop-label">
                    {videoOpen ? "Hide video" : "Video"}
                  </span>
                </button>
              ) : null}
            </header>

            {active && videoOpen ? (
              <Suspense
                fallback={
                  <p className="p-4" role="status">
                    Loading video…
                  </p>
                }
              >
                <VideoPanel
                  key={active.id}
                  channelId={active.id}
                  channelName={active.name}
                />
              </Suspense>
            ) : null}

            <div
              ref={timelineRef}
              className="hive-timeline flex-1 overflow-y-auto"
            >
              <div ref={timelineContentRef}>
                {loading && messages.length === 0 ? (
                  <div className="hive-empty" role="status">
                    <p>Loading the conversation…</p>
                  </div>
                ) : announcementsOpen && !active ? (
                  <div className="hive-empty hive-announcements-empty">
                    <Megaphone aria-hidden="true" />
                    <h3>Community updates belong here.</h3>
                    <p>
                      Announcements aren’t available to your account yet. A
                      community admin needs to set up the channel or give you
                      access.
                    </p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="hive-empty">
                    <Users aria-hidden="true" />
                    <h3>Make yourself at home.</h3>
                    <p>
                      This conversation is just getting started. Share a
                      question, an idea, or what you’re building.
                    </p>
                  </div>
                ) : (
                  <ChatTimeline
                    messages={messages}
                    reactions={reactions}
                    pubkey={pubkey}
                    statusOf={statusOf}
                    threadIndex={threadIndex}
                    onOpenThread={setOpenThreadRoot}
                    onReact={toggle}
                    onEdit={canPublish ? editMessage : undefined}
                    onDelete={deleteMessage}
                  />
                )}
              </div>
            </div>

            {/*
          The bottom inset keeps the composer clear of the home indicator on a
          phone; without it the send button sits under the swipe bar.
        */}
            {announcementsOpen && !active ? null : canPublish ? (
              <form onSubmit={onSend} className="hive-composer">
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
                    <span className="truncate text-neutral-400">
                      image attached
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      className="ml-auto shrink-0 text-neutral-500 hover:text-neutral-300"
                    >
                      remove
                    </button>
                  </div>
                ) : null}
                {recorder.error ? (
                  <p className="mb-2 text-red-400 text-sm">{recorder.error}</p>
                ) : null}
                {recorder.status !== "idle" ? (
                  <div className="mb-2 flex items-center gap-3 rounded-lg border border-red-900/60 bg-neutral-900 px-3 py-2">
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                    </span>
                    <span className="text-neutral-200 text-sm tabular-nums">
                      {formatVoiceNoteDuration(recorder.elapsedSeconds)}
                    </span>
                    <span
                      aria-hidden="true"
                      className="h-4 flex-1 overflow-hidden rounded bg-neutral-800"
                    >
                      <span
                        className="block h-full bg-amber-500/80 transition-[width] duration-100"
                        style={{
                          width: `${Math.round(recorder.level * 100)}%`,
                        }}
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => recorder.cancel()}
                      disabled={recorder.status === "processing" || uploading}
                      className="shrink-0 rounded-lg border border-neutral-700 px-2.5 py-1 text-neutral-300 text-xs disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void onVoiceSend()}
                      disabled={recorder.status === "processing" || uploading}
                      className="shrink-0 rounded-lg bg-amber-500 px-3 py-1 font-semibold text-neutral-950 text-xs disabled:opacity-50"
                    >
                      {recorder.status === "processing" || uploading
                        ? "Sending…"
                        : "Send"}
                    </button>
                  </div>
                ) : null}
                <div className="hive-composer-field relative flex items-center gap-2">
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
                    {uploading ? (
                      "…"
                    ) : (
                      <Paperclip size={19} aria-hidden="true" />
                    )}
                  </button>
                  {recorder.status === "idle" && !draft.trim() ? (
                    <button
                      type="button"
                      aria-label="Record a voice note"
                      onClick={() => void recorder.start()}
                      disabled={uploading || !activeId}
                      className="shrink-0 rounded-lg border border-neutral-700 px-2.5 py-2 text-neutral-300 text-sm disabled:opacity-50"
                    >
                      <Mic size={19} aria-hidden="true" />
                    </button>
                  ) : null}
                  <input
                    ref={composerRef}
                    value={draft}
                    aria-label={
                      active?.kind === "dm"
                        ? `Message ${dmLabel(active)}`
                        : active
                          ? `Message #${active.name}`
                          : "Message"
                    }
                    onChange={onComposerChange}
                    onKeyDown={(event) => {
                      if (mentionCandidates.length === 0) {
                        return;
                      }
                      if (
                        event.key === "ArrowDown" ||
                        event.key === "ArrowUp"
                      ) {
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
                      active
                        ? active.kind === "dm"
                          ? `Message ${dmLabel(active)}`
                          : `Message #${active.name}`
                        : "Select a channel"
                    }
                    className="min-w-0 flex-1 px-3 py-2 text-base placeholder:text-neutral-600"
                  />
                  {/*
              A phone has no Enter key worth relying on, so sending needs
              something to tap. It also takes Enter off the single-field
              implicit-submission rule, which is the fiddliest corner of form
              behaviour and varies by engine. Cheap insurance either way.
            */}
                  <button
                    type="submit"
                    aria-label="Send"
                    disabled={
                      !activeId || (draft.trim().length === 0 && !attachment)
                    }
                    className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 font-semibold text-neutral-950 text-sm disabled:opacity-40"
                  >
                    <span>Send</span>
                    <ArrowUp size={17} aria-hidden="true" />
                  </button>
                </div>
                <div className="hive-composer-hint">
                  <span>Markdown supported · @ to mention</span>
                  <span>
                    {onlineCount} {onlineCount === 1 ? "member" : "members"}{" "}
                    online
                  </span>
                </div>
              </form>
            ) : (
              <p className="hive-announcement-note">
                Announcements · Only channel owners and admins can publish. You
                can read and react here.
              </p>
            )}
          </main>

          {!membersOpen && !watchingRoom && !openThread && (
            <ChatContext
              channel={active}
              members={active ? members : (communityMembers.data ?? [])}
              statusOf={statusOf}
              onMembers={() => setMembersOpen(true)}
            />
          )}
          {membersOpen && !watchingRoom ? (
            <MembersPanel
              channel={active}
              members={active ? members : (communityMembers.data ?? [])}
              statusOf={statusOf}
              onClose={() => setMembersOpen(false)}
            />
          ) : null}

          {watchingRoom ? (
            <Suspense
              fallback={
                <p className="p-4" role="status">
                  Loading stream…
                </p>
              }
            >
              <StageWatch
                key={watchingRoom}
                room={watchingRoom}
                selfPubkey={pubkey}
                onClose={() => setWatchingRoom(null)}
              />
            </Suspense>
          ) : openThread && !membersOpen ? (
            <ThreadPanel
              canPublish={canPublish}
              thread={openThread}
              selfPubkey={pubkey}
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
      )}
    </CommunityShell>
  );
}
