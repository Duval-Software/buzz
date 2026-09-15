import { useState } from "react";
import type { Channel } from "@/features/chat/use-chat";
import type { ChannelMember } from "@/features/members/use-members";
import { useMembership } from "@/features/identity/use-identity";
import {
  POSTING_POLICY_EXTENSION,
  publishCommunityCommand,
  useRelayInfo,
  useCommunityMembers,
} from "./community-access";

/** Existing channel metadata command; only offered when this relay enforces the policy. */
export function ChannelPublishing({
  channel,
  members,
}: {
  channel: Channel;
  members: ChannelMember[];
}) {
  const info = useRelayInfo();
  const { identity } = useMembership();
  const roster = useCommunityMembers();
  const communityRole = roster.data?.find(
    (member) => member.pubkey === identity?.pubkey,
  )?.role;
  const role = members.find(
    (member) => member.pubkey === identity?.pubkey,
  )?.role;
  const supported = info.data?.supported_extensions?.includes(
    POSTING_POLICY_EXTENSION,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  if (
    channel.kind === "dm" ||
    (role !== "owner" &&
      role !== "admin" &&
      communityRole !== "owner" &&
      communityRole !== "admin")
  )
    return null;
  return (
    <details className="hive-channel-publishing">
      <summary>Channel publishing</summary>
      <p>
        Announcement channels are readable by the same audience. Only channel
        owners and admins can publish or reply.
      </p>
      {!supported ? (
        <p>
          This relay needs an update before announcement channels can be
          enabled.
        </p>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            const policy = String(
              new FormData(event.currentTarget).get("posting_policy"),
            );
            setBusy(true);
            setError("");
            setAccepted(false);
            try {
              await publishCommunityCommand(9002, [
                ["h", channel.id],
                ["posting_policy", policy],
              ]);
              setAccepted(true);
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not save channel publishing.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Who can publish
            <select
              key={channel.postingPolicy}
              name="posting_policy"
              defaultValue={channel.postingPolicy ?? "all"}
              disabled={busy}
            >
              <option value="all">Everyone with channel access</option>
              <option value="admins">Channel owners and admins</option>
            </select>
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Waiting for relay…" : "Save publishing policy"}
          </button>
          {accepted ? (
            <p role="status">The relay accepted the publishing policy.</p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </form>
      )}
    </details>
  );
}
