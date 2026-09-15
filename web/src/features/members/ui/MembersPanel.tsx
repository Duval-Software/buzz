import { ProfilePreview } from "@/features/profile/ui/ProfilePreview";
import { MemberSearch } from "@/features/profile/ui/MemberSearch";
import { ChannelPublishing } from "@/features/community/ChannelPublishing";
import type { Channel } from "@/features/chat/use-chat";
import type { ChannelMember } from "@/features/members/use-members";
import type { PresenceStatus } from "@/features/chat/use-presence";
import { PresenceDot } from "@/features/chat/ui/PresenceDot";
import { AvatarDisc } from "@/features/profile/ui/AvatarDisc";
import { useProfile, useNames } from "@/features/profile/use-profiles";

/**
 * The channel roster: people and agents, side by side.
 *
 * Agents are members here — that is CreatorHive's whole premise — so they are
 * not hidden in a separate tab. They are the same list with an honest badge,
 * because "who is in this room" includes the ones that answer at 4am.
 */
export function MemberRow({
  member,
  statusOf,
}: {
  member: ChannelMember;
  statusOf: (pubkey: string) => PresenceStatus;
}) {
  const names = useNames();
  const profile = useProfile(member.pubkey);
  const name = names(member.pubkey);
  return (
    <li className="flex items-center gap-2 rounded-lg px-2 py-1.5">
      <ProfilePreview
        pubkey={member.pubkey}
        name={name}
        status={statusOf(member.pubkey)}
      >
        <AvatarDisc pubkey={member.pubkey} name={name} size={32} />
        <span className="min-w-0 flex-1 truncate text-sm">
          {name}
          {!profile?.displayName ? <small>No display name set</small> : null}
        </span>
      </ProfilePreview>
      <PresenceDot status={statusOf(member.pubkey)} />
      {profile?.bot ? (
        <span className="shrink-0 rounded border border-neutral-700 px-1 text-neutral-500 text-xs">
          agent
        </span>
      ) : null}
      {member.role !== "member" ? (
        <span className="shrink-0 rounded border border-amber-800 px-1 text-amber-400 text-xs">
          {member.role}
        </span>
      ) : null}
    </li>
  );
}

export function MembersPanel({
  channel,
  members,
  statusOf,
  onClose,
}: {
  channel?: Channel;
  members: ChannelMember[];
  statusOf: (pubkey: string) => PresenceStatus;
  onClose: () => void;
}) {
  const names = useNames();
  const byName = (a: ChannelMember, b: ChannelMember) =>
    names(a.pubkey).localeCompare(names(b.pubkey));
  const online = members
    .filter((m) => statusOf(m.pubkey) !== "offline")
    .sort(byName);
  const offline = members
    .filter((m) => statusOf(m.pubkey) === "offline")
    .sort(byName);

  return (
    <aside className="hive-panel flex w-full shrink-0 flex-col border-neutral-800 bg-neutral-950 max-md:fixed max-md:inset-0 max-md:z-40 md:border-l">
      <header className="flex items-center justify-between gap-2 border-neutral-800 border-b px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div>
          <h2 className="font-semibold text-sm">Members</h2>
          <p className="text-neutral-500 text-xs">
            {members.length} {channel ? "in this channel" : "in the community"}{" "}
            · {online.length} around
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
      <MemberSearch />
      <ul className="flex-1 overflow-y-auto p-2">
        {members.length === 0 && (
          <li className="p-2 text-neutral-500 text-sm">
            The verified member list is not available yet.
          </li>
        )}
        {online.map((member) => (
          <MemberRow key={member.pubkey} member={member} statusOf={statusOf} />
        ))}
        {offline.length > 0 && online.length > 0 ? (
          <li className="px-2 pt-2 pb-1 text-neutral-600 text-xs">Offline</li>
        ) : null}
        {offline.map((member) => (
          <MemberRow key={member.pubkey} member={member} statusOf={statusOf} />
        ))}
      </ul>
      {channel ? (
        <ChannelPublishing
          key={channel.id}
          channel={channel}
          members={members}
        />
      ) : null}
      <p className="hive-panel-note">
        Members include people, agents, and test identities. Presence shows who
        has recently connected.
      </p>
    </aside>
  );
}
