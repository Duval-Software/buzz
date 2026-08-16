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
function MemberRow({
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
      <AvatarDisc pubkey={member.pubkey} name={name} />
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      <PresenceDot status={statusOf(member.pubkey)} />
      {profile?.bot ? (
        <span className="shrink-0 rounded border border-neutral-700 px-1 text-neutral-500 text-xs">
          agent
        </span>
      ) : null}
      {member.role === "owner" ? (
        <span className="shrink-0 rounded border border-amber-800 px-1 text-amber-400 text-xs">
          owner
        </span>
      ) : null}
    </li>
  );
}

export function MembersPanel({
  members,
  statusOf,
  onClose,
}: {
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
    <aside className="flex w-full shrink-0 flex-col border-neutral-800 bg-neutral-950 max-md:fixed max-md:inset-0 max-md:z-40 md:w-72 md:border-l">
      <header className="flex items-center justify-between gap-2 border-neutral-800 border-b px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div>
          <h2 className="font-semibold text-sm">Members</h2>
          <p className="text-neutral-500 text-xs">
            {members.length} in this channel · {online.length} around
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
      <ul className="flex-1 overflow-y-auto p-2">
        {online.map((member) => (
          <MemberRow key={member.pubkey} member={member} statusOf={statusOf} />
        ))}
        {offline.length > 0 && online.length > 0 ? (
          <li className="px-2 pt-2 pb-1 text-neutral-600 text-xs">offline</li>
        ) : null}
        {offline.map((member) => (
          <MemberRow key={member.pubkey} member={member} statusOf={statusOf} />
        ))}
      </ul>
    </aside>
  );
}
