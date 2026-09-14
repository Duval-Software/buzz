import {
  Menu,
  Megaphone,
  Search,
  Settings2,
  Bot,
  Radio,
  ChevronDown,
  Pin,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  type Channel,
  useChannels,
  useRelayState,
} from "@/features/chat/use-chat";
import { useUnread } from "@/features/chat/use-unread";
import { useInboxUnread } from "@/features/inbox/use-inbox";
import { useMembership } from "@/features/identity/use-identity";
import { IdentityPanel } from "@/features/identity/ui/IdentityPanel";
import { AvatarDisc } from "@/features/profile/ui/AvatarDisc";
import { useNames } from "@/features/profile/use-profiles";
import { SearchPanel } from "@/features/search/ui/SearchPanel";
import { NewDmPicker } from "@/features/dm/ui/NewDmPicker";
import { LiveRooms } from "@/features/video/ui/LiveRooms";
import { stageBaseUrl } from "@/features/video/stage-client";
import { ThemeToggle } from "@/shared/theme/ThemeToggle";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { CommunityDialog } from "./CommunityDialog";
import { cn } from "@/shared/lib/cn";
import { HiveBrand, SurfacesNav } from "./SurfacesNav";
import "./community-shell.css";

function ConnectionPill() {
  const state = useRelayState();
  const label =
    state === "ready"
      ? "connected"
      : state === "offline"
        ? "reconnecting"
        : "connecting";
  if (state === "ready") return null;
  return (
    <span className="hive-connection" role="status">
      {label}
    </span>
  );
}

/** The shared member app frame: navigation, channel discovery, profile and theme. */
export function CommunityShell({
  channels,
  channelsLoading,
  activeId = null,
  announcementsOpen = false,
  activeRoom = null,
  onOpenRoom,
  onSelectChannel,
  children,
}: {
  channels: Channel[];
  channelsLoading: boolean;
  activeId?: string | null;
  announcementsOpen?: boolean;
  activeRoom?: string | null;
  onOpenRoom?: (room: string) => void;
  onSelectChannel?: (id: string) => void;
  children: (controls: {
    openChannels: () => void;
    openSearch: () => void;
    drawerOpen: boolean;
    totalUnread: number;
  }) => ReactNode;
}) {
  const { identity, signOut } = useMembership();
  const { error: channelsError, retry: retryChannels } = useChannels();
  const pubkey = identity?.pubkey ?? "";
  const names = useNames();
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const preferenceKey = `hive-sidebar:${relayWsUrl()}:${pubkey}`;
  const [preferences, setPreferences] = useState<{
    key: string;
    pinned: string[];
    last?: string;
  }>({ key: "", pinned: [] });
  const [browseOpen, setBrowseOpen] = useState(false);
  const [channelFilter, setChannelFilter] = useState("");
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? "{}");
      setPreferences({
        key: preferenceKey,
        pinned: Array.isArray(saved.pinned)
          ? saved.pinned.filter((id: unknown) => typeof id === "string")
          : [],
        last: typeof saved.last === "string" ? saved.last : undefined,
      });
    } catch {
      setPreferences({ key: preferenceKey, pinned: [] });
    }
  }, [preferenceKey]);
  useEffect(() => {
    if (preferences.key !== preferenceKey) return;
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(preferences));
    } catch {
      /* Navigation preferences remain usable in memory. */
    }
  }, [preferenceKey, preferences]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dmPickerOpen, setDmPickerOpen] = useState(false);
  const channelIds = useMemo(() => channels.map((c) => c.id), [channels]);
  const { unread } = useUnread(channelIds, activeId, pubkey);
  const inboxUnread = useInboxUnread(pubkey);
  const videoConfigured = stageBaseUrl() !== null;
  const announcementChannel = findAnnouncementChannel(channels);
  const regularChannels = channels.filter(
    (c) => c.kind === "channel" && c.id !== announcementChannel?.id,
  );
  const pinned = preferences.key === preferenceKey ? preferences.pinned : [];
  const sidebarChannels = [...regularChannels]
    .sort(
      (a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)),
    )
    .filter(
      (channel, index) =>
        index < 6 || pinned.includes(channel.id) || channel.id === activeId,
    );
  const lastChannel = channels.find(
    (channel) => channel.id === (activeId ?? preferences.last),
  )?.id;
  useEffect(() => {
    if (
      activeId &&
      preferences.key === preferenceKey &&
      preferences.last !== activeId
    )
      setPreferences((previous) => ({ ...previous, last: activeId }));
  }, [activeId, preferenceKey, preferences.key, preferences.last]);
  const dmChannels = channels.filter((c) => c.kind === "dm");
  const dmLabel = (c: Channel) =>
    c.participants
      .filter((p) => p !== pubkey.toLowerCase())
      .map((p) => names(p))
      .join(", ") || "just you";
  const totalUnread = [...unread.values()].reduce((sum, n) => sum + n, 0);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, []);
  function selectChannel(id: string) {
    setDrawerOpen(false);
    if (onSelectChannel) onSelectChannel(id);
    else void navigate({ to: "/chat", search: { channel: id } });
  }
  function openRoom(room: string) {
    if (onOpenRoom) onOpenRoom(room);
    else void navigate({ to: "/chat", search: { room } });
  }
  return (
    <div className="hive-app hive-chat">
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close channel list"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      ) : null}

      <aside
        id="channel-navigation"
        data-open={drawerOpen}
        className={cn(
          "hive-sidebar hive-chat-sidebar z-40",
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:transition-transform",
          drawerOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
        )}
      >
        <HiveBrand
          channel={lastChannel}
          onNavigate={() => setDrawerOpen(false)}
        />
        <ConnectionPill />
        <button
          type="button"
          className="hive-chat-search"
          onClick={() => setSearchOpen(true)}
        >
          <Search size={16} aria-hidden="true" />
          <span>Search the Hive</span>
          <span className="hive-search-shortcut" aria-hidden="true">
            ⌘K
          </span>
        </button>
        <div className="hive-sidebar-scroll">
          <SurfacesNav
            inboxUnread={inboxUnread}
            onNavigate={() => setDrawerOpen(false)}
          >
            <button
              type="button"
              className="hive-nav-link hive-announcements-link"
              aria-label="Announcements"
              aria-current={
                announcementsOpen ||
                (!!announcementChannel && activeId === announcementChannel.id)
                  ? "page"
                  : undefined
              }
              onClick={() => {
                setDrawerOpen(false);
                void navigate({
                  to: "/chat",
                  search: { view: "announcements" },
                });
              }}
            >
              <Megaphone size={17} aria-hidden="true" />
              <span>Announcements</span>
              {announcementChannel &&
                (unread.get(announcementChannel.id) ?? 0) > 0 && (
                  <span className="hive-unread">
                    {unread.get(announcementChannel.id)}
                  </span>
                )}
            </button>
          </SurfacesNav>
          <section className="hive-studio" aria-label="Studio">
            <h2 className="hive-eyebrow">Studio</h2>
            <Link
              to="/live"
              onClick={() => setDrawerOpen(false)}
              className="hive-nav-link"
              activeProps={{ className: "is-active", "aria-current": "page" }}
            >
              <Radio size={17} aria-hidden="true" />
              <span>Live studio</span>
            </Link>
            {videoConfigured && (
              <LiveRooms
                selfPubkey={pubkey}
                activeRoom={activeRoom}
                onOpen={(room) => {
                  openRoom(room);
                  setDrawerOpen(false);
                }}
              />
            )}
          </section>
          <nav
            aria-label="Channels and direct messages"
            className="hive-channel-list"
          >
            <details open className="hive-sidebar-section">
              <summary className="hive-section-heading">
                <ChevronDown size={12} aria-hidden="true" />
                Channels
              </summary>
              {channelsError && (
                <p role="alert" className="px-2 py-1 text-neutral-400 text-sm">
                  {channelsError}{" "}
                  <button
                    type="button"
                    onClick={retryChannels}
                    className="underline"
                  >
                    Retry channels
                  </button>
                </p>
              )}
              {channelsLoading && channels.length === 0 ? (
                <p className="px-2 py-1 text-neutral-500 text-sm">loading…</p>
              ) : channels.length === 0 && !channelsError ? (
                <p className="px-2 py-1 text-neutral-500 text-sm">
                  No channels available to your account yet.
                </p>
              ) : (
                sidebarChannels.map((channel) => (
                  <button
                    key={channel.id}
                    aria-label={
                      channel.postingPolicy === "admins"
                        ? `Announcement channel ${channel.name}`
                        : undefined
                    }
                    type="button"
                    onClick={() => {
                      selectChannel(channel.id);
                    }}
                    aria-current={channel.id === activeId ? "page" : undefined}
                    className={cn(
                      "w-full truncate rounded px-2 py-2.5 text-left text-sm md:py-1.5",
                      channel.id === activeId
                        ? "bg-neutral-800 text-neutral-50"
                        : "text-neutral-400 hover:bg-neutral-900",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {channel.postingPolicy === "admins" ? (
                          <Megaphone
                            size={14}
                            className="inline mr-1"
                            aria-hidden="true"
                          />
                        ) : (
                          <span className="text-neutral-600">#</span>
                        )}{" "}
                        {channel.name}
                      </span>
                      {pinned.includes(channel.id) && (
                        <Pin
                          size={11}
                          className="hive-channel-pin"
                          aria-label="Pinned"
                        />
                      )}
                      {(unread.get(channel.id) ?? 0) > 0 && (
                        <span
                          className="hive-unread-dot"
                          role="img"
                          aria-label="Unread messages"
                        />
                      )}
                    </span>
                  </button>
                ))
              )}
              <button
                type="button"
                className="hive-browse-channels"
                onClick={() => {
                  setChannelFilter("");
                  setBrowseOpen(true);
                }}
              >
                Browse channels
              </button>
            </details>
            <div className="hive-dm-section">
              <details open className="hive-sidebar-section">
                <summary className="hive-section-heading">
                  <ChevronDown size={12} aria-hidden="true" />
                  Direct messages
                </summary>
                {dmChannels.length === 0 &&
                !channelsLoading &&
                !channelsError ? (
                  <p className="hive-dm-empty">
                    Start a conversation with a member.
                  </p>
                ) : null}
                {dmChannels.map((channel) => (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => {
                      selectChannel(channel.id);
                    }}
                    aria-current={channel.id === activeId ? "page" : undefined}
                    className={cn(
                      "w-full truncate rounded px-2 py-2.5 text-left text-sm md:py-1.5",
                      channel.id === activeId
                        ? "bg-neutral-800 text-neutral-50"
                        : "text-neutral-400 hover:bg-neutral-900",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="hive-dm-name">
                        <AvatarDisc
                          pubkey={
                            channel.participants.find((p) => p !== pubkey) ??
                            pubkey
                          }
                          name={dmLabel(channel)}
                          size={25}
                        />
                        <span className="truncate">{dmLabel(channel)}</span>
                      </span>
                      {(unread.get(channel.id) ?? 0) > 0 ? (
                        <span className="shrink-0 rounded-full bg-amber-500 px-1.5 text-neutral-950 text-xs">
                          {unread.get(channel.id)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </details>
              <div className="hive-dm-heading flex items-center justify-between">
                <button
                  type="button"
                  aria-label="New message"
                  onClick={() => setDmPickerOpen(true)}
                  className="rounded border border-neutral-700 px-1.5 text-neutral-400 text-xs hover:text-neutral-200"
                >
                  +
                </button>
              </div>
            </div>
          </nav>
        </div>
        <Link
          to="/agents"
          className={cn(
            "hive-nav-link hive-personal-agents",
            path === "/workflows" && "is-active",
          )}
          aria-current={path === "/workflows" ? "page" : undefined}
          activeProps={{ className: "is-active", "aria-current": "page" }}
          onClick={() => setDrawerOpen(false)}
        >
          <Bot size={17} aria-hidden="true" />
          <span>Agents</span>
        </Link>
        <div className="hive-sidebar-account">
          {identity ? (
            <button
              type="button"
              onClick={() => setIdentityOpen(true)}
              className="hive-profile-button"
            >
              <AvatarDisc pubkey={pubkey} name={names(pubkey)} size={30} />
              <span>
                Your profile<small>{names(pubkey)}</small>
              </span>
              <Settings2 size={17} aria-hidden="true" />
            </button>
          ) : null}
          <ThemeToggle />
        </div>
      </aside>

      {browseOpen && (
        <CommunityDialog
          label="Browse channels"
          description="Find a channel. Pin the ones you visit most."
          icon={Search}
          onClose={() => setBrowseOpen(false)}
        >
          <div className="hive-channel-browser">
            <input
              aria-label="Filter channels"
              placeholder="Find a channel…"
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
            />
            {regularChannels
              .filter((channel) =>
                channel.name
                  .toLowerCase()
                  .includes(channelFilter.toLowerCase()),
              )
              .map((channel) => (
                <div key={channel.id}>
                  <button
                    type="button"
                    onClick={() => {
                      selectChannel(channel.id);
                      setBrowseOpen(false);
                    }}
                  >
                    # {channel.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Pin ${channel.name}`}
                    aria-pressed={pinned.includes(channel.id)}
                    onClick={() =>
                      setPreferences((previous) => ({
                        ...previous,
                        pinned: pinned.includes(channel.id)
                          ? pinned.filter((id) => id !== channel.id)
                          : [...pinned, channel.id],
                      }))
                    }
                  >
                    <Pin size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}
            {!regularChannels.some((channel) =>
              channel.name.toLowerCase().includes(channelFilter.toLowerCase()),
            ) && <p>No channels found.</p>}
          </div>
        </CommunityDialog>
      )}
      {dmPickerOpen ? (
        <NewDmPicker
          selfPubkey={pubkey}
          onOpened={selectChannel}
          onClose={() => setDmPickerOpen(false)}
        />
      ) : null}

      {searchOpen ? (
        <SearchPanel
          channels={channels}
          onOpenChannel={selectChannel}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}

      {identityOpen && identity ? (
        <IdentityPanel
          identity={identity}
          onClose={() => setIdentityOpen(false)}
          onSignOut={signOut}
        />
      ) : null}

      <div className="hive-chat-workspace">
        {children({
          openChannels: () => setDrawerOpen(true),
          openSearch: () => setSearchOpen(true),
          drawerOpen,
          totalUnread,
        })}
      </div>
    </div>
  );
}

/** Resolve the same accessible announcement channel in navigation and direct routes. */
export function findAnnouncementChannel(channels: Channel[]) {
  return (
    channels.find(
      (c) => c.kind === "channel" && c.name.toLowerCase() === "announcements",
    ) ??
    channels.find((c) => c.kind === "channel" && c.postingPolicy === "admins")
  );
}

/** Shared page header and scroll area for community destinations. */
export function CommunityPage({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { channels, loading: channelsLoading } = useChannels();
  return (
    <CommunityShell channels={channels} channelsLoading={channelsLoading}>
      {({ openChannels, drawerOpen, totalUnread }) => (
        <main className={cn("hive-community-page", className)}>
          <header className="hive-chat-header hive-community-header">
            <button
              type="button"
              aria-label="Open community navigation"
              aria-expanded={drawerOpen}
              aria-controls="channel-navigation"
              onClick={openChannels}
              className="hive-mobile-trigger relative md:hidden"
            >
              <Menu size={20} aria-hidden="true" />
              {totalUnread > 0 && (
                <span className="hive-unread">{totalUnread}</span>
              )}
            </button>
            <div>
              <h1>{title}</h1>
            </div>
            {action}
          </header>
          {children}
        </main>
      )}
    </CommunityShell>
  );
}
