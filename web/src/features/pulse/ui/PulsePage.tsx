import { useSessionDraft } from "@/shared/lib/use-session-draft";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ContentSkeleton } from "@/shared/ui/ContentSkeleton";
import { Activity, ArrowUpRight, Check, Paperclip, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { contentWithoutMediaLines } from "@/features/chat/message-media";
import {
  MessageContent,
  MessageAttachments,
} from "@/features/chat/ui/MessageContent";
import {
  uploadBytes,
  uploadImage,
  type UploadedMedia,
} from "@/features/chat/upload";
import {
  usePulse,
  buildKey,
  POST_TYPES,
  type PostType,
  type PulseNote,
} from "@/features/pulse/use-pulse";
import { AvatarDisc } from "@/features/profile/ui/AvatarDisc";
import { useNames } from "@/features/profile/use-profiles";
import { CommunityPage } from "@/features/surfaces/ui/CommunityShell";
import { CommunityDialog } from "@/features/surfaces/ui/CommunityDialog";
import { useMembership } from "@/features/identity/use-identity";
import { relayWsUrl } from "@/shared/lib/relay-url";
import "./pulse.css";

type NoteAction = "edit" | "resolve" | "delete" | "report";
function timeOf(ts: number) {
  const delta = Date.now() / 1000 - ts;
  if (delta < 90) return "just now";
  if (delta < 3600) return `${Math.round(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.round(delta / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
function NoteCard({
  note,
  replies,
  api,
  onReply,
  onAction,
  onLike,
  names,
  self,
  followed,
  onFollow,
  busy,
  depth = 0,
}: {
  note: PulseNote;
  replies: Map<string, PulseNote[]>;
  api: ReturnType<typeof usePulse>;
  onReply: (note: PulseNote) => void;
  onAction: (note: PulseNote, action: NoteAction) => void;
  onLike: (id: string) => void;
  names: (pk: string) => string;
  self: string;
  followed: string[];
  onFollow: (note: PulseNote) => void;
  busy: boolean;
  depth?: number;
}) {
  const own = replies.get(note.id) ?? [];
  const like = api.likesOf(note.id);
  const isFollowing = followed.includes(buildKey(note));
  return (
    <article
      data-update-id={note.id}
      tabIndex={-1}
      className={`hive-note pulse-note ${depth > 0 ? "pulse-reply" : ""}`}
      aria-label={`Update by ${names(note.pubkey)}`}
    >
      <header className="pulse-author">
        <AvatarDisc pubkey={note.pubkey} name={names(note.pubkey)} size={32} />
        <span>{names(note.pubkey)}</span>
        <time dateTime={new Date(note.createdAt * 1000).toISOString()}>
          {timeOf(note.createdAt)}
        </time>
        {note.editedAt && <small>edited</small>}
        <details className="pulse-note-menu">
          <summary aria-label="Update options">•••</summary>
          <div>
            {note.pubkey === self ? (
              <>
                <button type="button" onClick={() => onAction(note, "edit")}>
                  Edit update
                </button>
                {!note.replyTo &&
                  note.postType === "feedback" &&
                  !note.resolved && (
                    <button
                      type="button"
                      onClick={() => onAction(note, "resolve")}
                    >
                      Resolve feedback
                    </button>
                  )}
                <button type="button" onClick={() => onAction(note, "delete")}>
                  Delete update
                </button>
              </>
            ) : (
              <button type="button" onClick={() => onAction(note, "report")}>
                Report update
              </button>
            )}
          </div>
        </details>
      </header>
      {!note.replyTo && note.tags.some((tag) => tag[0] === "hive-post") && (
        <div className="pulse-note-context">
          <span>
            {note.resolved ? "Feedback resolved" : POST_TYPES[note.postType]}
          </span>
          {note.projectUrl && (
            <a href={note.projectUrl} target="_blank" rel="noreferrer">
              {note.project || new URL(note.projectUrl).hostname}
              <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          )}
        </div>
      )}
      <div className="pulse-note-body">
        <MessageContent
          selfPubkey={self}
          message={{
            content: contentWithoutMediaLines(note.content),
            media: note.media,
            mentions: note.tags.filter((t) => t[0] === "p").map((t) => t[1]),
            emoji: new Map(),
          }}
        />
        <MessageAttachments message={note} />
        {note.resolved && note.outcome && (
          <div className="pulse-outcome">
            <Check size={15} aria-hidden="true" />
            <div>
              <strong>What changed</strong>
              <p>{note.outcome}</p>
            </div>
          </div>
        )}
        <footer className="pulse-note-actions">
          <button
            type="button"
            disabled={busy}
            aria-pressed={like.mine}
            onClick={() => onLike(note.id)}
          >
            <span aria-hidden="true">♡</span> {like.count || "Like"}
          </button>
          <button type="button" onClick={() => onReply(note)}>
            Reply{own.length > 0 ? ` · ${own.length}` : ""}
          </button>
          {!note.replyTo && note.projectUrl && (
            <button
              type="button"
              aria-pressed={isFollowing}
              onClick={() => onFollow(note)}
            >
              {isFollowing ? "Following build" : "Follow build"}
            </button>
          )}
        </footer>
      </div>
      {depth < 8 &&
        own.map((reply) => (
          <NoteCard
            key={reply.id}
            note={reply}
            replies={replies}
            api={api}
            onReply={onReply}
            onAction={onAction}
            onLike={onLike}
            names={names}
            self={self}
            followed={followed}
            onFollow={onFollow}
            busy={busy}
            depth={depth + 1}
          />
        ))}
      {depth === 8 && own.length > 0 && (
        <p className="pulse-help">More replies are outside this view.</p>
      )}
    </article>
  );
}

export function PulsePage() {
  const { identity } = useMembership();
  const self = identity?.pubkey.toLowerCase() ?? "";
  const search = useSearch({ from: "/pulse" });
  const navigate = useNavigate();
  const api = usePulse(self, search.update);
  const focusedUpdate = useRef<string | null>(null);
  useEffect(() => {
    if (!search.update) {
      focusedUpdate.current = null;
      return;
    }
    if (
      api.targetLoading ||
      api.targetError ||
      !api.notes.some((note) => note.id === search.update) ||
      focusedUpdate.current === search.update
    )
      return;
    const element = document.querySelector<HTMLElement>(
      `[data-update-id="${CSS.escape(search.update)}"]`,
    );
    if (element) {
      element.scrollIntoView({ block: "center", behavior: "instant" });
      element.focus({ preventScroll: true });
      focusedUpdate.current = search.update;
    }
  }, [search.update, api.targetLoading, api.targetError, api.notes]);
  const names = useNames();
  const [composing, setComposing] = useState(false);
  const [followingOnly, setFollowingOnly] = useState(false);
  const [draft, setDraft] = useSessionDraft(self, "pulse");
  const [postType, setPostType] = useState<PostType>("progress");
  const [project, setProject] = useState("");
  const [projectUrl, setProjectUrl] = useState("");
  const [attachment, setAttachment] = useState<UploadedMedia | undefined>();
  const [attachmentName, setAttachmentName] = useState("");
  const [replyTo, setReplyTo] = useState<PulseNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<{
    note: PulseNote;
    action: NoteAction;
  } | null>(null);
  const [editText, setEditText] = useState("");
  const [category, setCategory] = useState("spam");
  const [modalError, setModalError] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const followKey = `hive-pulse-follow:${relayWsUrl()}:${self}`;
  const [follows, setFollows] = useState<{ key: string; values: string[] }>({
    key: "",
    values: [],
  });
  useEffect(() => {
    try {
      const values: unknown = JSON.parse(
        localStorage.getItem(followKey) ?? "[]",
      );
      setFollows({
        key: followKey,
        values: Array.isArray(values)
          ? values.filter((v) => typeof v === "string")
          : [],
      });
    } catch {
      setFollows({ key: followKey, values: [] });
    }
  }, [followKey]);
  const followed = follows.key === followKey ? follows.values : [];
  function follow(note: PulseNote) {
    const key = buildKey(note);
    const values = followed.includes(key)
      ? followed.filter((item) => item !== key)
      : [...followed, key];
    setFollows({ key: followKey, values });
    try {
      localStorage.setItem(followKey, JSON.stringify(values));
    } catch {
      setNotice(
        "Following for this visit only; browser storage is unavailable.",
      );
    }
  }
  const { roots, replies } = useMemo(() => {
    const byParent = new Map<string, PulseNote[]>();
    const tops: PulseNote[] = [];
    const ids = new Set(api.notes.map((n) => n.id));
    for (const note of api.notes) {
      if (note.replyTo && ids.has(note.replyTo)) {
        const list = byParent.get(note.replyTo) ?? [];
        list.push(note);
        byParent.set(note.replyTo, list);
      } else tops.push(note);
    }
    for (const list of byParent.values())
      list.sort((a, b) => a.createdAt - b.createdAt);
    return { roots: tops, replies: byParent };
  }, [api.notes]);
  const visible = search.update
    ? api.notes.filter((note) => note.id === search.update)
    : roots.filter(
        (note) =>
          (!followingOnly || followed.includes(buildKey(note))) &&
          (filter === "all" ||
            (note.postType === filter &&
              (filter !== "feedback" || !note.resolved))),
      );
  async function post() {
    if (busy || uploading) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!replyTo && project.trim() && !projectUrl.trim())
        throw new Error("Add a build link so members can follow this project.");
      await api.publish(draft, {
        postType,
        project,
        projectUrl,
        attachment,
        reply: replyTo ?? undefined,
      });
      setDraft("");
      setAttachment(undefined);
      setAttachmentName("");
      setReplyTo(null);
      setFilter("all");
      setFollowingOnly(false);
      setComposing(false);
      setNotice("Posted to the community.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not post. Your draft is still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function attach(file: File) {
    if (uploading || busy) return;
    setUploading(true);
    setError("");
    try {
      if (file.type.startsWith("image/"))
        setAttachment(await uploadImage(file));
      else if (file.type === "video/mp4") {
        if (file.size > 25 * 1024 * 1024)
          throw new Error("Keep demo videos under 25 MB.");
        setAttachment(
          await uploadBytes(
            await file.arrayBuffer(),
            file.type,
            25 * 1024 * 1024,
          ),
        );
      } else throw new Error("Choose an image or MP4 demo.");
      setAttachmentName(file.name);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not upload this file.",
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  function openAction(note: PulseNote, action: NoteAction) {
    setSelected({ note, action });
    setEditText(action === "edit" ? note.content : "");
    setModalError("");
    setCategory("spam");
  }
  async function applyAction() {
    if (!selected || busy) return;
    setBusy(true);
    setModalError("");
    try {
      const note = api.notes.find((n) => n.id === selected.note.id);
      if (!note) throw new Error("This update is no longer available.");
      if (selected.action === "edit") await api.edit(note, editText);
      if (selected.action === "resolve")
        await api.edit(note, note.content, editText);
      if (selected.action === "delete") await api.remove(note);
      if (selected.action === "report")
        await api.report(note, category, editText);
      setNotice(
        selected.action === "report"
          ? "Report submitted for moderator review."
          : "Update saved.",
      );
      setSelected(null);
    } catch (cause) {
      setModalError(
        cause instanceof Error ? cause.message : "The change was not accepted.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <CommunityPage className="hive-pulse" title="Pulse">
      <div className="hive-feed">
        <div className="pulse-feed-heading">
          <fieldset className="pulse-feed-tabs">
            <legend className="sr-only">Feed</legend>
            <button
              type="button"
              aria-pressed={!followingOnly}
              onClick={() => setFollowingOnly(false)}
            >
              Latest
            </button>
            <button
              type="button"
              aria-pressed={followingOnly}
              onClick={() => setFollowingOnly(true)}
            >
              Following
            </button>
          </fieldset>
          <select
            aria-label="Filter updates"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All updates</option>
            <option value="feedback">Needs feedback</option>
            <option value="shipped">Shipped</option>
          </select>
          <button
            type="button"
            className="pulse-new-update"
            onClick={() => {
              setReplyTo(null);
              setError("");
              setComposing(true);
            }}
          >
            <Plus size={15} aria-hidden="true" />
            New update
          </button>
        </div>
        {composing && (
          <CommunityDialog
            label={replyTo ? "Write a reply" : "New update"}
            description={
              replyTo
                ? "Join the conversation."
                : "Share what you’re building with the hive."
            }
            icon={Activity}
            busy={busy || uploading}
            onClose={() => {
              if (!busy && !uploading) setComposing(false);
            }}
          >
            <div className="hive-feed-composer pulse-composer">
              {!replyTo && (
                <fieldset className="pulse-types" disabled={busy}>
                  <legend className="sr-only">Update type</legend>
                  {Object.entries(POST_TYPES).map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="pulse-type"
                        value={value}
                        checked={postType === value}
                        onChange={() => setPostType(value as PostType)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {replyTo && (
                <p className="pulse-reply-target">
                  Replying to {names(replyTo.pubkey)}{" "}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setReplyTo(null)}
                  >
                    Cancel reply
                  </button>
                </p>
              )}
              <textarea
                ref={textarea}
                data-dialog-autofocus
                disabled={busy}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={10000}
                rows={3}
                aria-label={
                  replyTo ? "Write your reply" : "What are you building?"
                }
                placeholder={
                  replyTo
                    ? "Write your reply"
                    : postType === "feedback"
                      ? "What are you trying to solve? What feedback would help?"
                      : postType === "shipped"
                        ? "What did you ship? Share a demo and what you learned."
                        : "What changed, and what’s next?"
                }
              />
              {!replyTo && (
                <details className="pulse-build-fields">
                  <summary>
                    <Plus size={13} aria-hidden="true" />
                    Link this update to a build
                  </summary>
                  <div>
                    <label>
                      Build name
                      <input
                        value={project}
                        onChange={(e) => setProject(e.target.value)}
                        disabled={busy}
                        maxLength={80}
                        placeholder="e.g. Replay bookmarks"
                      />
                    </label>
                    <label>
                      Build link
                      <input
                        type="url"
                        value={projectUrl}
                        onChange={(e) => setProjectUrl(e.target.value)}
                        disabled={busy}
                        placeholder="https://…"
                      />
                    </label>
                  </div>
                  <p className="pulse-help">
                    Use the same link on future updates so people can follow
                    this build.
                  </p>
                </details>
              )}
              {attachment && (
                <div className="pulse-attachment">
                  <span>{attachmentName}</span>
                  <button
                    type="button"
                    disabled={busy || uploading}
                    onClick={() => {
                      setAttachment(undefined);
                      setAttachmentName("");
                    }}
                  >
                    Remove attachment
                  </button>
                </div>
              )}
              <div className="pulse-compose-actions">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*,video/mp4"
                  hidden
                  aria-label="Choose build attachment"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void attach(file);
                  }}
                />
                <button
                  type="button"
                  disabled={busy || uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip size={16} aria-hidden="true" />
                  {uploading ? "Uploading…" : "Add screenshot or demo"}
                </button>
                <button
                  type="button"
                  className="pulse-post"
                  disabled={busy || uploading || !draft.trim()}
                  onClick={() => void post()}
                >
                  {busy ? "Posting…" : "Post"}
                </button>
              </div>
              <div className="pulse-recap-template">
                {" "}
                {!replyTo && (
                  <button
                    type="button"
                    disabled={busy || Boolean(draft)}
                    onClick={() => {
                      setPostType("progress");
                      setDraft(
                        "## Studio recap\n\nWhat changed:\n\nMember input that shaped it:\n\nWhat’s next:\n\nReplay and timestamps:",
                      );
                      textarea.current?.focus();
                    }}
                  >
                    Recap a live build
                  </button>
                )}
              </div>
              <p className="pulse-help">
                Visible to the community. Images up to 10 MB; MP4 demos up to 25
                MB. Replies notify the person you reply to in Inbox.
              </p>
              {error && <p role="alert">{error}</p>}
            </div>
          </CommunityDialog>
        )}
        {!composing && error && <p role="alert">{error}</p>}
        {followingOnly && (
          <p className="pulse-help">
            Following in this browser. Notifications and cross-device sync
            aren’t connected yet.
          </p>
        )}
        {notice && (
          <p role="status" className="pulse-help">
            {notice}
          </p>
        )}
        {search.update && (
          <p className="pulse-help">
            <button
              type="button"
              onClick={() => void navigate({ to: "/pulse", search: {} })}
            >
              ← Back to all updates
            </button>
          </p>
        )}
        {api.targetError && (
          <p className="pulse-help" role="alert">
            {api.targetError}{" "}
            <button type="button" onClick={api.retryTarget}>
              Retry
            </button>
          </p>
        )}
        {api.targetLoading || (api.loading && api.notes.length === 0) ? (
          <ContentSkeleton feed />
        ) : visible.length === 0 ? (
          <div className="hive-empty">
            <Activity aria-hidden="true" />
            <h3>
              {search.update
                ? "Update unavailable."
                : followingOnly
                  ? "Keep up with a build."
                  : "The next update could be yours."}
            </h3>
            <p>
              {search.update
                ? "Return to all updates to keep exploring."
                : followingOnly
                  ? "Follow a linked build from Latest to see its updates here."
                  : "Share progress, show what shipped, or ask for a second pair of eyes."}
            </p>
          </div>
        ) : (
          <section aria-label="Community updates">
            {visible.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                replies={replies}
                api={api}
                names={names}
                self={self}
                followed={followed}
                onFollow={follow}
                busy={busy}
                onAction={openAction}
                onReply={(target) => {
                  setReplyTo(target);
                  setComposing(true);
                  setError("");
                }}
                onLike={(id) => {
                  setBusy(true);
                  setError("");
                  void api
                    .toggleLike(id)
                    .catch((cause) =>
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Could not update this reaction.",
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
              />
            ))}
          </section>
        )}
        <details className="pulse-guidelines">
          <summary>Posting and community guidelines</summary>
          <p>
            Share your own work, give specific feedback, and keep private
            information out of posts and demos. Authors can edit or delete their
            updates. Report spam or abuse from an update’s menu; moderators
            review reports through the existing moderation tools.
          </p>
          <p>
            Pulse is a member build feed. Official team notices belong in
            Announcements. A studio recap should explain what changed, whose
            input helped, what’s next, and where to watch the replay.
          </p>
        </details>
      </div>
      {selected && (
        <CommunityDialog
          label={
            {
              edit: "Edit update",
              resolve: "Resolve feedback",
              delete: "Delete update",
              report: "Report update",
            }[selected.action]
          }
          icon={Activity}
          busy={busy}
          onClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <div className="pulse-action-dialog">
            {selected.action === "delete" ? (
              <p>
                This removes the update from the feed. Replies remain;
                previously saved copies may still exist.
              </p>
            ) : (
              <>
                {selected.action === "report" && (
                  <label>
                    Reason
                    <select
                      aria-label="Reason"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      disabled={busy}
                    >
                      <option value="spam">Spam</option>
                      <option value="illegal">Illegal content</option>
                      <option value="impersonation">Impersonation</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                )}
                <label>
                  {selected.action === "resolve"
                    ? "Feedback outcome"
                    : selected.action === "edit"
                      ? "Update text"
                      : "Additional context (optional)"}
                  <textarea
                    disabled={busy}
                    value={editText}
                    maxLength={selected.action === "edit" ? 10000 : 2000}
                    rows={6}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                </label>
              </>
            )}
            {modalError && <p role="alert">{modalError}</p>}
            <button
              className="pulse-post"
              type="button"
              disabled={
                busy ||
                ((selected.action === "edit" ||
                  selected.action === "resolve") &&
                  !editText.trim())
              }
              onClick={() => void applyAction()}
            >
              {busy
                ? "Saving…"
                : selected.action === "delete"
                  ? "Delete update"
                  : selected.action === "report"
                    ? "Submit report"
                    : selected.action === "resolve"
                      ? "Mark resolved"
                      : "Save changes"}
            </button>
          </div>
        </CommunityDialog>
      )}
    </CommunityPage>
  );
}
