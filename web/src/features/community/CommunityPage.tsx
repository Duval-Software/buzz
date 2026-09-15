import { resolveAccount } from "@/features/identity/accounts";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMembership } from "@/features/identity/use-identity";
import { useNames } from "@/features/profile/use-profiles";
import { SurfaceShell } from "@/features/surfaces/ui/SurfaceShell";
import { CommunityDialog } from "@/features/surfaces/ui/CommunityDialog";
import {
  publishCommunityCommand,
  useCommunityMembers,
  useRelayInfo,
} from "./community-access";

type Change = {
  kind: 9030 | 9031 | 9032;
  pubkey: string;
  role?: string;
  label: string;
  username?: string;
};

export function CommunityPage() {
  const { identity } = useMembership();
  const info = useRelayInfo();
  const roster = useCommunityMembers();
  const client = useQueryClient();
  const names = useNames();
  const role = roster.data?.find(
    (member) => member.pubkey === identity?.pubkey,
  )?.role;
  const canManage = !roster.isError && (role === "owner" || role === "admin");
  const [change, setChange] = useState<Change | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");

  async function confirm() {
    if (!change || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await publishCommunityCommand(change.kind, [
        ["p", change.pubkey],
        ...(change.role ? [["role", change.role]] : []),
        ...(change.kind === 9032
          ? [
              ["reason", reason],
              [
                "expected",
                roster.data?.find((member) => member.pubkey === change.pubkey)
                  ?.role || "member",
              ],
            ]
          : []),
      ]);
      setMessage("The relay accepted the change.");
      setChange(null);
      await client.invalidateQueries({ queryKey: ["community-members"] });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update membership.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SurfaceShell title="Community settings">
      <section className="hive-community-settings">
        <h2>Community members</h2>
        <p>
          Community admins manage access. Channel owners and admins manage their
          own channels.
        </p>
        {info.isPending ? (
          <p role="status">Checking relay support…</p>
        ) : info.isError ||
          !info.data?.self ||
          !info.data.supported_nips?.includes(43) ? (
          <p role="status">
            Verified community management is unavailable on this relay.
          </p>
        ) : roster.isPending ? (
          <p role="status">Loading verified membership…</p>
        ) : roster.isError ? (
          <p role="alert">{roster.error.message}</p>
        ) : !canManage ? (
          <>
            <p>Only community owners and admins can manage access.</p>
            <h3>Community administrators</h3>
            <ul className="hive-access-list">
              {roster.data
                ?.filter(
                  (member) =>
                    member.role === "owner" || member.role === "admin",
                )
                .map((member) => (
                  <li key={member.pubkey}>
                    <details>
                      <summary>
                        {names(member.pubkey)} · {member.role}
                      </summary>
                      <p className="hive-access-key">{member.pubkey}</p>
                    </details>
                  </li>
                ))}
            </ul>
          </>
        ) : (
          <>
            <p>
              Your community role: <strong>{role}</strong>
            </p>
            <form
              className="hive-access-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const username = String(data.get("username") ?? "");
                const requestedRole = String(data.get("role") ?? "member");
                setBusy(true);
                setError("");
                try {
                  const account = await resolveAccount(username);
                  setChange({
                    kind: 9030,
                    pubkey: account.pubkey,
                    username: account.username,
                    role: requestedRole,
                    label: `Add ${requestedRole}`,
                  });
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Could not find account.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Member username
                <input
                  name="username"
                  required
                  pattern="[A-Za-z0-9_]{3,32}"
                  autoComplete="off"
                  placeholder="username"
                />
              </label>
              <label>
                Community role
                <select name="role">
                  <option value="member">Member</option>
                  {role === "owner" ? (
                    <option value="admin">Admin</option>
                  ) : null}
                </select>
              </label>
              <button type="submit" disabled={busy}>
                {busy ? "Finding account…" : "Review access"}
              </button>
            </form>
            <ul className="hive-access-list">
              {roster.data?.map((member) => (
                <li key={member.pubkey}>
                  <span className="hive-access-name">
                    {names(member.pubkey)}
                    <small>{member.role}</small>
                  </span>
                  {member.pubkey !== identity?.pubkey &&
                  member.role !== "owner" ? (
                    <div>
                      {role === "owner" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setError("");
                            setChange({
                              kind: 9032,
                              pubkey: member.pubkey,
                              role:
                                member.role === "admin" ? "member" : "admin",
                              label:
                                member.role === "admin"
                                  ? "Change to member"
                                  : "Change to admin",
                            });
                          }}
                        >
                          {member.role === "admin"
                            ? "Make member"
                            : "Make admin"}
                        </button>
                      ) : null}
                      {role === "owner" || member.role === "member" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setError("");
                            setChange({
                              kind: 9031,
                              pubkey: member.pubkey,
                              label: "Remove access",
                            });
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
        {message ? <p role="status">{message}</p> : null}
        {error && !change ? <p role="alert">{error}</p> : null}
      </section>
      {change ? (
        <CommunityDialog
          label={change.label}
          busy={busy}
          onClose={() => setChange(null)}
        >
          <p>
            {change.label} for{" "}
            <strong>
              {change.username ? `@${change.username}` : names(change.pubkey)}
            </strong>
            ?
          </p>
          <details>
            <summary>Account identifier</summary>
            <p className="hive-access-key">{change.pubkey}</p>
          </details>
          <p>
            {change.kind === 9031
              ? "This member will lose community access."
              : change.role === "admin"
                ? "Community admins can add and remove ordinary members."
                : "This member will have ordinary member access."}
          </p>
          {change.kind === 9032 && (
            <label>
              Reason
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={3}
                maxLength={500}
              />
            </label>
          )}
          {error ? <p role="alert">{error}</p> : null}
          <button type="button" disabled={busy} onClick={() => setChange(null)}>
            Cancel
          </button>
          <button
            type="button"
            disabled={
              busy || (change.kind === 9032 && reason.trim().length < 3)
            }
            onClick={() => void confirm()}
          >
            {busy ? "Waiting for relay…" : "Confirm change"}
          </button>
        </CommunityDialog>
      ) : null}
    </SurfaceShell>
  );
}
