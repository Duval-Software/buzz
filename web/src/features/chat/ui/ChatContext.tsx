import { ArrowUpRight } from "lucide-react";
import type { Channel } from "@/features/chat/use-chat";
import type { PresenceStatus } from "@/features/chat/use-presence";
import type { ChannelMember } from "@/features/members/use-members";
import { MemberRow } from "@/features/members/ui/MembersPanel";
import { useNames } from "@/features/profile/use-profiles";

/** Persistent desktop roster; the Members button opens the same roster on smaller screens. */
export function ChatContext({
  channel,
  members,
  statusOf,
  onMembers,
}: {
  channel?: Channel;
  members: ChannelMember[];
  statusOf: (pubkey: string) => PresenceStatus;
  onMembers: () => void;
}) {
  const names = useNames();
  const byName = (a: ChannelMember, b: ChannelMember) =>
    names(a.pubkey).localeCompare(names(b.pubkey));
  const present = members
    .filter((m) => statusOf(m.pubkey) !== "offline")
    .sort(byName);
  const offline = members
    .filter((m) => statusOf(m.pubkey) === "offline")
    .sort(byName);
  return (
    <aside className="hive-chat-context" aria-label="Member list">
      <header>
        <h2>
          Members <span>{members.length}</span>
        </h2>
        <p>
          {channel
            ? channel.kind === "dm"
              ? "Direct message"
              : `#${channel.name}`
            : "CreatorHive community"}
        </p>
      </header>
      {present.length > 0 && (
        <section aria-label="Recently active members">
          <h3 className="hive-eyebrow">Recently active · {present.length}</h3>
          <ul>
            {present.map((member) => (
              <MemberRow
                key={member.pubkey}
                member={member}
                statusOf={statusOf}
              />
            ))}
          </ul>
        </section>
      )}
      {offline.length > 0 && (
        <section aria-label="Offline members">
          <h3 className="hive-eyebrow">Offline · {offline.length}</h3>
          <ul>
            {offline.map((member) => (
              <MemberRow
                key={member.pubkey}
                member={member}
                statusOf={statusOf}
              />
            ))}
          </ul>
        </section>
      )}
      {members.length === 0 && (
        <p className="hive-roster-empty">
          The member list isn’t available yet. Members will appear when the
          relay provides a verified roster.
        </p>
      )}
      <footer>
        <button type="button" className="hive-context-link" onClick={onMembers}>
          {channel ? "View channel members" : "View community members"}{" "}
          <ArrowUpRight size={14} aria-hidden="true" />
        </button>
        <p>Presence reflects recent activity.</p>
      </footer>
    </aside>
  );
}
