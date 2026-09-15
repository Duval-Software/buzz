import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ShieldCheck, Search, ArrowLeft, Check } from "lucide-react";
import { SurfaceShell } from "@/features/surfaces/ui/SurfaceShell";
import { CommunityDialog } from "@/features/surfaces/ui/CommunityDialog";
import { useMembership } from "@/features/identity/use-identity";
import { useChannels } from "@/features/chat/use-chat";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  readStaff,
  staffCommand,
  type Section,
  type StaffData,
  type StaffItem,
} from "./api";
import "./moderation.css";

const sections: Section[] = [
  "reports",
  "members",
  "channels",
  "appeals",
  "history",
];
const title = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
const name = (item: StaffItem) =>
  item.display_name ||
  (item.username ? `@${item.username}` : "Community member");
type Decision = {
  kind: Parameters<typeof staffCommand>[0];
  args: Record<string, string>;
  label: string;
  timeoutSeconds?: number;
};

export function ModerationPage() {
  const { identity } = useMembership();
  const [section, setSection] = useState<Section>("reports");
  const [status, setStatus] = useState("open");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [notice, setNotice] = useState("");
  const client = useQueryClient();
  const data = useQuery({
    queryKey: [
      "staff",
      relayWsUrl(),
      identity?.pubkey,
      section,
      status,
      query,
      page,
    ],
    queryFn: () =>
      readStaff(
        section === "channels" ? "reports" : section,
        section === "channels" ? "open" : status,
        query,
        page,
      ),
    retry: false,
    refetchInterval: 15000,
  });
  const current = data.data?.items.find(
    (item) => (item.id || item.pubkey) === selected,
  );
  const admin = data.data?.role === "admin" || data.data?.role === "owner";
  function chooseSection(next: Section) {
    setSection(next);
    setStatus(next === "reports" || next === "appeals" ? "open" : "");
    setSearch("");
    setQuery("");
    setPage(0);
    setSelected(null);
    setNotice("");
  }
  return (
    <SurfaceShell title="Manage CreatorHive" className="hive-moderation">
      <div className="staff-workspace">
        {data.isPending ? (
          <p role="status">Checking staff access…</p>
        ) : data.isError ? (
          <div role="alert">
            <h2>Management unavailable</h2>
            <p>{data.error.message}</p>
            <button type="button" onClick={() => void data.refetch()}>
              Retry
            </button>
          </div>
        ) : (
          data.data && (
            <>
              <nav className="staff-tabs" aria-label="Management sections">
                {sections
                  .filter(
                    (tab) => admin || (tab !== "appeals" && tab !== "channels"),
                  )
                  .map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      aria-current={section === tab ? "page" : undefined}
                      onClick={() => chooseSection(tab)}
                    >
                      {title(tab)}
                    </button>
                  ))}
              </nav>
              {notice && (
                <p className="staff-notice" role="status">
                  <Check size={16} aria-hidden="true" />
                  {notice}
                </p>
              )}
              {section === "channels" ? (
                <Channels />
              ) : (
                <>
                  <form
                    className="staff-toolbar"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setQuery(search);
                      setPage(0);
                      setSelected(null);
                    }}
                  >
                    <label className="staff-search">
                      <Search size={17} aria-hidden="true" />
                      <input
                        aria-label={`Search ${section}`}
                        placeholder={`Search ${section}`}
                        maxLength={100}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                      <button type="submit">Search</button>
                    </label>
                    {(section === "reports" || section === "appeals") && (
                      <select
                        aria-label="Status"
                        value={status}
                        onChange={(event) => {
                          setStatus(event.target.value);
                          setPage(0);
                          setSelected(null);
                        }}
                      >
                        <option value="">All statuses</option>
                        {(section === "reports"
                          ? ["open", "escalated", "resolved", "dismissed"]
                          : ["open", "upheld", "reversed"]
                        ).map((value) => (
                          <option key={value} value={value}>
                            {title(value)}
                          </option>
                        ))}
                      </select>
                    )}
                  </form>
                  <div
                    className={`staff-columns ${current ? "has-selection" : ""}`}
                  >
                    <section className="staff-list" aria-label={title(section)}>
                      {data.data.items.length === 0 && (
                        <div className="staff-empty">
                          <ShieldCheck size={28} aria-hidden="true" />
                          <h3>
                            {query
                              ? "No matches"
                              : section === "reports"
                                ? "Nothing waiting here"
                                : "Nothing here yet"}
                          </h3>
                          <p>
                            {query
                              ? "Try another name or search."
                              : "New activity will appear here."}
                          </p>
                        </div>
                      )}
                      {data.data.items.map((item) => (
                        <button
                          type="button"
                          className="staff-row"
                          key={item.id || item.pubkey}
                          aria-pressed={selected === (item.id || item.pubkey)}
                          onClick={() =>
                            setSelected(item.id || item.pubkey || null)
                          }
                        >
                          <span className="staff-avatar" aria-hidden="true">
                            {name(item).slice(0, 1).toUpperCase()}
                          </span>
                          <span className="staff-row-main">
                            <strong>{name(item)}</strong>
                            <span>
                              {section === "reports"
                                ? title(item.report_type || "Report")
                                : section === "members"
                                  ? `@${item.username || "unclaimed"} · ${title(item.role || "member")}`
                                  : title(item.action || "Review")}
                            </span>
                          </span>
                          <span className="staff-row-meta">
                            {item.status ||
                              (item.banned
                                ? "Banned"
                                : item.rename_required
                                  ? "Rename needed"
                                  : item.muted_until &&
                                      new Date(item.muted_until) > new Date()
                                    ? "Timed out"
                                    : "")}
                            {item.created_at && (
                              <time dateTime={item.created_at}>
                                {new Date(item.created_at).toLocaleDateString(
                                  undefined,
                                  { month: "short", day: "numeric" },
                                )}
                              </time>
                            )}
                          </span>
                        </button>
                      ))}
                      <div className="staff-pagination">
                        <button
                          type="button"
                          disabled={page === 0}
                          onClick={() => {
                            setPage((p) => p - 1);
                            setSelected(null);
                          }}
                        >
                          Previous
                        </button>
                        <span>Page {page + 1}</span>
                        <button
                          type="button"
                          disabled={!data.data.more}
                          onClick={() => {
                            setPage((p) => p + 1);
                            setSelected(null);
                          }}
                        >
                          Next
                        </button>
                      </div>
                    </section>
                    <aside className="staff-detail" aria-label="Review details">
                      {current ? (
                        <>
                          <button
                            type="button"
                            className="staff-back"
                            onClick={() => setSelected(null)}
                          >
                            <ArrowLeft size={16} />
                            Back to list
                          </button>
                          <Details
                            key={current.id || current.pubkey}
                            item={current}
                            section={section}
                            data={data.data}
                            onDecision={setDecision}
                          />
                        </>
                      ) : (
                        <div className="staff-empty">
                          <h3>
                            Select{" "}
                            {section === "members" ? "a member" : "an item"}
                          </h3>
                          <p>Details and available actions appear here.</p>
                        </div>
                      )}
                    </aside>
                  </div>
                </>
              )}
              <footer className="staff-policy">
                Word filter:{" "}
                {data.data.policy.revision
                  ? `${data.data.policy.count} rules · ${data.data.policy.revision.slice(0, 8)}`
                  : "Not deployed"}
                <span>Updated through a reviewed deployment</span>
              </footer>
            </>
          )
        )}
      </div>
      {decision && (
        <DecisionDialog
          decision={decision}
          onClose={() => setDecision(null)}
          onSaved={async () => {
            setDecision(null);
            setSelected(null);
            setNotice("The change was saved.");
            await client.invalidateQueries({ queryKey: ["staff"] });
            await client.invalidateQueries({ queryKey: ["community-members"] });
          }}
        />
      )}
    </SurfaceShell>
  );
}

function Details({
  item,
  section,
  data,
  onDecision,
}: {
  item: StaffItem;
  section: Section;
  data: StaffData;
  onDecision: (decision: Decision) => void;
}) {
  const [duration, setDuration] = useState("3600");
  const [role, setRole] = useState("member");
  const target = item.pubkey || item.target_pubkey;
  const memberTarget = target && target !== data.self;
  const admin = data.role !== "moderator";
  const canAct =
    memberTarget &&
    (data.role === "owner"
      ? item.role !== "owner"
      : !["owner", "admin", ...(admin ? [] : ["moderator"])].includes(
          item.role || "",
        ));
  const history = useQuery({
    queryKey: ["staff-history", relayWsUrl(), data.self, target],
    queryFn: () => readStaff("history", target),
    enabled: Boolean(target),
    retry: false,
  });
  const report = (action: string, label: string) =>
    onDecision({
      kind: 9044,
      label,
      timeoutSeconds: action === "timeout" ? Number(duration) : undefined,
      args: {
        report: item.report_event_id || "",
        action,
        expected: item.status || "open",
      },
    });
  return (
    <>
      <h2>{name(item)}</h2>
      {item.username && <p className="staff-handle">@{item.username}</p>}
      {section === "reports" && (
        <>
          <div className="staff-section-label">Reported message</div>
          <blockquote>
            {item.evidence ||
              "This report concerns a profile or attachment. No message text is available."}
          </blockquote>
          {item.removed && <p>Message removed</p>}
          <div className="staff-section-label">Report context</div>
          <p className="staff-text">{item.note || "No additional context."}</p>
          {["open", "escalated"].includes(item.status || "") && (
            <div className="staff-actions">
              {item.target_event_id && !item.removed && (
                <button
                  type="button"
                  onClick={() => report("delete", "Remove reported message")}
                >
                  Remove message
                </button>
              )}
              {target && (
                <>
                  <TimeoutSelect value={duration} onChange={setDuration} />
                  <button
                    type="button"
                    onClick={() =>
                      report("timeout", "Time out member and resolve report")
                    }
                  >
                    Time out member
                  </button>
                  {admin && (
                    <button
                      type="button"
                      onClick={() =>
                        report("ban", "Ban member and resolve report")
                      }
                    >
                      Ban member
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={() => report("dismiss", "Dismiss report")}
              >
                Dismiss report
              </button>
              {item.status !== "escalated" && (
                <button
                  type="button"
                  onClick={() =>
                    report("escalate", "Escalate to an administrator")
                  }
                >
                  Escalate
                </button>
              )}
            </div>
          )}
        </>
      )}
      {section === "members" && (
        <>
          <p>
            {title(item.role || "member")}
            {item.banned ? " · Banned" : ""}
          </p>
          {item.muted_until && new Date(item.muted_until) > new Date() && (
            <p>
              Timed out until{" "}
              <time dateTime={item.muted_until}>
                {new Date(item.muted_until).toLocaleString()}
              </time>
            </p>
          )}
          {item.rename_required && <p>Username change required</p>}
          {canAct && (
            <div className="staff-actions">
              <TimeoutSelect value={duration} onChange={setDuration} />
              <button
                type="button"
                onClick={() =>
                  onDecision({
                    kind: 9042,
                    label: "Time out member",
                    timeoutSeconds: Number(duration),
                    args: {
                      p: target || "",
                    },
                  })
                }
              >
                Apply timeout
              </button>
              {admin && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      onDecision({
                        kind: item.banned ? 9041 : 9040,
                        label: item.banned ? "Lift ban" : "Ban member",
                        args: { p: target || "" },
                      })
                    }
                  >
                    {item.banned ? "Lift ban" : "Ban member"}
                  </button>
                  {item.muted_until &&
                    new Date(item.muted_until) > new Date() && (
                      <button
                        type="button"
                        onClick={() =>
                          onDecision({
                            kind: 9043,
                            label: "End timeout",
                            args: { p: target || "" },
                          })
                        }
                      >
                        End timeout
                      </button>
                    )}
                  {item.username && !item.rename_required && (
                    <button
                      type="button"
                      onClick={() =>
                        onDecision({
                          kind: 9045,
                          label: "Require a new username",
                          args: {
                            p: target || "",
                            username: item.username || "",
                          },
                        })
                      }
                    >
                      Require username change
                    </button>
                  )}
                  <label>
                    Community role
                    <select
                      value={role}
                      onChange={(event) => setRole(event.target.value)}
                    >
                      <option value="member">Member</option>
                      <option value="moderator">Moderator</option>
                      {data.role === "owner" && (
                        <option value="admin">Admin</option>
                      )}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={role === item.role}
                    onClick={() =>
                      onDecision({
                        kind: 9032,
                        label: `Change role to ${role}`,
                        args: {
                          p: target || "",
                          role,
                          expected: item.role || "member",
                        },
                      })
                    }
                  >
                    Change role
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
      {section === "appeals" && (
        <>
          <div className="staff-section-label">Original action</div>
          <p>
            {title(item.action || "Action")} — {item.reason}
          </p>
          <div className="staff-section-label">Member appeal</div>
          <blockquote>{item.explanation}</blockquote>
          {item.decision && <p>{item.decision}</p>}
          {item.status === "open" && (
            <div className="staff-actions">
              {["upheld", "reversed"]
                .filter(
                  (choice) =>
                    choice !== "reversed" || item.action !== "delete_message",
                )
                .map((choice) => (
                  <button
                    type="button"
                    key={choice}
                    onClick={() =>
                      onDecision({
                        kind: 9046,
                        label:
                          choice === "upheld"
                            ? "Uphold original action"
                            : "Reverse restriction",
                        args: {
                          appeal: item.id || "",
                          decision: choice,
                          ...(item.original_actor === data.self
                            ? { exception: "" }
                            : {}),
                        },
                      })
                    }
                  >
                    {choice === "upheld"
                      ? "Uphold action"
                      : "Reverse restriction"}
                  </button>
                ))}
            </div>
          )}
        </>
      )}
      {section === "history" && (
        <>
          <p>
            {title(item.action || "Action")} by {item.actor || "Staff"}
          </p>
          <p>{item.reason}</p>
          {item.detail && <p>{item.detail}</p>}
          <p className="staff-handle">
            Applied
            {item.created_at && (
              <>
                {" "}
                ·{" "}
                <time dateTime={item.created_at}>
                  {new Date(item.created_at).toLocaleString()}
                </time>
              </>
            )}
          </p>
        </>
      )}
      {target && section !== "history" && (
        <>
          <div className="staff-section-label">Recent moderation history</div>
          {history.isPending ? (
            <p>Loading history…</p>
          ) : history.isError ? (
            <p role="alert">History unavailable. Refresh before deciding.</p>
          ) : history.data.items.length === 0 ? (
            <p>No previous actions.</p>
          ) : (
            <ul className="staff-history">
              {history.data.items.map((entry) => (
                <li key={entry.id}>
                  <strong>{title(entry.action || "Action")}</strong>
                  <p>{entry.reason}</p>
                  <span>
                    {entry.actor} ·{" "}
                    {entry.created_at
                      ? new Date(entry.created_at).toLocaleString()
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
function TimeoutSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      Timeout length
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {[
          ["600", "10 minutes"],
          ["3600", "1 hour"],
          ["86400", "24 hours"],
          ["604800", "7 days"],
        ].map(([seconds, label]) => (
          <option value={seconds} key={seconds}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
function DecisionDialog({
  decision,
  onClose,
  onSaved,
}: {
  decision: Decision;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [exception, setException] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <CommunityDialog
      label={decision.label}
      busy={busy}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="staff-confirm"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await staffCommand(decision.kind, {
              ...decision.args,
              reason,
              ...(decision.timeoutSeconds
                ? {
                    expiration: String(
                      Math.floor(Date.now() / 1000) + decision.timeoutSeconds,
                    ),
                  }
                : {}),
              ...("exception" in decision.args ? { exception } : {}),
            });
            await onSaved();
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Change failed. Please retry.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Reason shown to the member
          <textarea
            data-dialog-autofocus
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {"exception" in decision.args && (
          <label>
            Why is independent review unavailable?
            <textarea
              required
              minLength={10}
              maxLength={500}
              value={exception}
              onChange={(event) => setException(event.target.value)}
            />
            <span>
              The server permits this only if no other unrestricted
              administrator is available.
            </span>
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="staff-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy || reason.trim().length < 3}>
            {busy ? "Saving…" : "Confirm change"}
          </button>
        </div>
      </form>
    </CommunityDialog>
  );
}
function Channels() {
  const { channels, loading } = useChannels();
  return (
    <section className="staff-channel-list">
      <h2>Channel management</h2>
      <p>
        Open a channel to use its existing membership and publishing controls.
      </p>
      {loading ? (
        <p role="status">Loading channels…</p>
      ) : (
        channels
          .filter((channel) => channel.kind !== "dm")
          .map((channel) => (
            <Link key={channel.id} to="/chat" search={{ channel: channel.id }}>
              <strong># {channel.name}</strong>
              <span>
                {channel.postingPolicy === "admins"
                  ? "Announcements · staff publishing"
                  : "Member publishing"}
              </span>
              <span>Open →</span>
            </Link>
          ))
      )}
    </section>
  );
}
