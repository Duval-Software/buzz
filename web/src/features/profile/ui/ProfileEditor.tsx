import { useEffect, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { CommunityDialog } from "@/features/surfaces/ui/CommunityDialog";
import { ManagedAuthGate } from "@/features/identity/ui/ManagedAuthGate";
import { CommunityGate } from "@/features/identity/ui/CommunityGate";
import { Eye, ImagePlus, UserRound } from "lucide-react";
import { interests } from "@/features/onboarding/member-profile";
import { useMembership } from "@/features/identity/use-identity";
import { usePulse } from "@/features/pulse/use-pulse";
import {
  accents,
  ownPublicProfile,
  savePublicProfile,
  uploadProfileImage,
  type PublicProfile,
  type Highlight,
} from "../public-profile";
import { ProfileView, ProfileImage } from "./ProfileView";
import { socialPlatforms, socialPlatform } from "../social-platforms";
import { useSessionDraft } from "@/shared/lib/use-session-draft";
import { profileDraft, restoreProfileDraft } from "../profile-draft";

/** The public profile editor stays above the current community screen. */
export function ProfileEditor({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const publicPage = useRouterState({
    select: (state) => /^\/(?:@|%40)[^/]+\/?$/i.test(state.location.pathname),
  });
  const editor = <ProfileEditorForm busy={busy} setBusy={setBusy} />;
  return (
    <CommunityDialog
      label="Edit public profile"
      icon={UserRound}
      busy={busy}
      onClose={onClose}
    >
      {publicPage ? (
        <ManagedAuthGate>
          <CommunityGate>{editor}</CommunityGate>
        </ManagedAuthGate>
      ) : (
        editor
      )}
    </CommunityDialog>
  );
}

function ProfileEditorForm({
  busy,
  setBusy,
}: {
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState(false);
  const [section, setSection] = useState("profile-details");
  const [retry, setRetry] = useState(0);
  const { identity } = useMembership();
  const [draft, setDraft] = useSessionDraft(identity?.pubkey, "public-profile");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saved = useRef<PublicProfile | null>(null);
  const dirty =
    !!profile &&
    !!saved.current &&
    JSON.stringify(profileDraft(profile)) !==
      JSON.stringify(profileDraft(saved.current));
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry reloads a failed editor request.
  useEffect(() => {
    let active = true;
    void ownPublicProfile()
      .then((p) => {
        if (active) {
          saved.current = p;
          const restored = restoreProfileDraft(p, draftRef.current);
          setProfile(restored);
          if (restored !== p)
            setNote("Restored your unsaved changes from this tab.");
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [retry, identity?.pubkey]);
  function change(patch: Partial<PublicProfile>) {
    if (!profile) return;
    const next = { ...profile, ...patch };
    setProfile(next);
    setDraft(JSON.stringify(profileDraft(next)));
    setNote("");
  }
  function validate() {
    const invalid = form.current?.querySelector<HTMLElement>(":invalid");
    if (!invalid) return true;
    const panel = invalid.closest<HTMLFieldSetElement>(
      "fieldset[data-section]",
    );
    if (panel) setSection(panel.id);
    requestAnimationFrame(() => form.current?.reportValidity());
    return false;
  }
  async function save() {
    if (!profile || busy || !validate()) return;
    setBusy(true);
    setError("");
    try {
      const result = await savePublicProfile(profile);
      const next = { ...profile, published: result.published };
      saved.current = next;
      setProfile(next);
      setDraft("");
      setNote(
        result.published
          ? "Profile saved."
          : "Draft saved. Only you can see it.",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Your changes are still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File, apply: (id: string) => void) {
    setBusy(true);
    setError("");
    try {
      apply(await uploadProfileImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  function highlight(index: number, value: Highlight) {
    if (profile)
      change({
        highlights: profile.highlights.map((h, i) => (i === index ? value : h)),
      });
  }
  function reorder(index: number, offset: number) {
    if (!profile) return;
    const list = [...profile.highlights];
    [list[index], list[index + offset]] = [list[index + offset], list[index]];
    change({ highlights: list });
  }
  return (
    <div ref={editor} className="portfolio-editor">
      {!preview && profile && (
        <nav
          className="portfolio-editor-sections"
          aria-label="Profile customization"
        >
          {[
            ["profile-details", "Profile"],
            ["profile-appearance", "Appearance"],
            ["profile-interests", "Interests"],
            ["profile-socials", "Socials & links"],
            ["profile-projects", "Featured work"],
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-controls={id}
              aria-pressed={section === id}
              onClick={() => {
                setSection(id);
                editor.current
                  ?.querySelector(".portfolio-editor-content")
                  ?.scrollTo(0, 0);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      <div className="portfolio-editor-content">
        {error && (
          <p className="portfolio-error" role="alert">
            {error}
            {!profile && (
              <button type="button" onClick={() => setRetry((n) => n + 1)}>
                Retry
              </button>
            )}
          </p>
        )}
        {note && (
          <p className="portfolio-notice" role="status">
            {note}
          </p>
        )}
        {!profile ? (
          !error && <p role="status">Loading your profile…</p>
        ) : preview ? (
          <>
            <p className="portfolio-notice">Previewing your current changes.</p>
            <ProfileView profile={{ ...profile, owner: false }} />
          </>
        ) : (
          <div className="portfolio-editor-grid">
            <form
              ref={form}
              className="portfolio-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <fieldset
                id="profile-details"
                data-section
                hidden={section !== "profile-details"}
                disabled={busy}
              >
                <legend>Profile details</legend>
                <div className="portfolio-editor-handle">
                  <span>@{profile.username}</span>
                  <Link to="/onboarding">Change username</Link>
                </div>
                <label>
                  Display name
                  <input
                    required
                    maxLength={60}
                    value={profile.display_name}
                    onChange={(e) => change({ display_name: e.target.value })}
                  />
                </label>
                <label>
                  Bio
                  <textarea
                    rows={3}
                    maxLength={320}
                    value={profile.bio}
                    placeholder="A little about you"
                    onChange={(e) => change({ bio: e.target.value })}
                  />
                </label>
                <label>
                  Currently building
                  <input
                    maxLength={120}
                    value={profile.build_status ?? ""}
                    placeholder="What are you working on?"
                    onChange={(e) => change({ build_status: e.target.value })}
                  />
                </label>
                <label>
                  Project link (optional)
                  <input
                    type="url"
                    maxLength={2048}
                    value={profile.build_url ?? ""}
                    placeholder="https://"
                    onChange={(e) => change({ build_url: e.target.value })}
                  />
                </label>
                <label>
                  Who can see this profile?
                  <select
                    value={profile.visibility}
                    onChange={(e) =>
                      change({
                        visibility: e.target
                          .value as PublicProfile["visibility"],
                      })
                    }
                  >
                    <option value="public">Anyone with the link</option>
                    <option value="members">CreatorHive members only</option>
                  </select>
                </label>
                <small>
                  Hidden from search engines. Public visitors can still copy and
                  share anything you publish.
                </small>
              </fieldset>
              <fieldset
                id="profile-appearance"
                data-section
                hidden={section !== "profile-appearance"}
                disabled={busy}
              >
                <legend>Make it yours</legend>
                {(["avatar", "cover"] as const).map((field) => (
                  <div key={field} className="portfolio-upload">
                    <div className={`portfolio-upload-preview ${field}`}>
                      {profile[field] ? (
                        <ProfileImage id={profile[field]} alt="" />
                      ) : field === "avatar" ? (
                        <UserRound size={24} />
                      ) : (
                        <ImagePlus size={24} />
                      )}
                    </div>
                    <label>
                      {field === "avatar" ? "Profile photo" : "Cover image"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file)
                            void upload(file, (id) => change({ [field]: id }));
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {profile[field] && (
                      <button
                        type="button"
                        onClick={() => change({ [field]: null })}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <small>JPG, PNG or WebP. Up to 5 MB.</small>
                <fieldset
                  className="portfolio-colors"
                  aria-label="Accent color"
                >
                  {Object.entries(accents).map(([key, color]) => (
                    <button
                      type="button"
                      key={key}
                      aria-label={`${key} accent`}
                      aria-pressed={profile.accent === key}
                      style={{ background: color }}
                      onClick={() =>
                        change({ accent: key as PublicProfile["accent"] })
                      }
                    />
                  ))}
                </fieldset>
              </fieldset>
              <fieldset
                id="profile-interests"
                data-section
                hidden={section !== "profile-interests"}
                disabled={busy}
              >
                <legend>What you build</legend>
                <small>Show what you’re into.</small>
                {interests.map(([id, label]) => (
                  <label className="portfolio-check" key={id}>
                    <input
                      type="checkbox"
                      checked={profile.interests.includes(id)}
                      onChange={(e) =>
                        change({
                          interests: e.target.checked
                            ? [...profile.interests, id]
                            : profile.interests.filter((i) => i !== id),
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
                <label className="portfolio-check">
                  <input
                    type="checkbox"
                    checked={profile.collaborating}
                    onChange={(e) =>
                      change({ collaborating: e.target.checked })
                    }
                  />
                  Open to collaborating
                </label>
              </fieldset>
              <fieldset
                id="profile-socials"
                data-section
                hidden={section !== "profile-socials"}
                disabled={busy}
              >
                <legend>Socials & links · {profile.links.length}/5</legend>
                <div className="portfolio-social-picker">
                  {socialPlatforms.map((platform) => (
                    <button
                      type="button"
                      key={platform.name}
                      disabled={
                        profile.links.length >= 5 ||
                        profile.links.some(
                          (link) => link.label === platform.name,
                        )
                      }
                      onClick={() =>
                        change({
                          links: [
                            ...profile.links,
                            { label: platform.name, url: "" },
                          ],
                        })
                      }
                    >
                      <span
                        className="portfolio-social-mark"
                        style={{ background: platform.color }}
                        aria-hidden="true"
                      >
                        {platform.mark}
                      </span>
                      {platform.name}
                    </button>
                  ))}
                </div>
                {profile.links.map((link, index) => (
                  <div
                    className="portfolio-link-editor"
                    // biome-ignore lint/suspicious/noArrayIndexKey: Controlled rows have no local state; indexes retain input focus during edits.
                    key={`link-${index}`}
                  >
                    <div className="portfolio-inline">
                      <label>
                        Link {index + 1} label
                        <input
                          required
                          maxLength={40}
                          value={link.label}
                          onChange={(e) =>
                            change({
                              links: profile.links.map((l, i) =>
                                i === index
                                  ? { ...l, label: e.target.value }
                                  : l,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        {link.label || `Link ${index + 1}`} URL
                        <input
                          required
                          type="url"
                          pattern="https?://.*"
                          maxLength={2048}
                          placeholder={
                            socialPlatforms.find(
                              (platform) => platform.name === link.label,
                            )?.example ?? "https://your-website.com"
                          }
                          value={link.url}
                          onChange={(e) =>
                            change({
                              links: profile.links.map((l, i) =>
                                i === index ? { ...l, url: e.target.value } : l,
                              ),
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="portfolio-highlight-controls">
                      <button
                        type="button"
                        disabled={index === 0}
                        aria-label={`Move link ${index + 1} up`}
                        onClick={() => {
                          const links = [...profile.links];
                          [links[index - 1], links[index]] = [
                            links[index],
                            links[index - 1],
                          ];
                          change({ links });
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={index === profile.links.length - 1}
                        aria-label={`Move link ${index + 1} down`}
                        onClick={() => {
                          const links = [...profile.links];
                          [links[index + 1], links[index]] = [
                            links[index],
                            links[index + 1],
                          ];
                          change({ links });
                        }}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove link ${index + 1}`}
                        onClick={() =>
                          change({
                            links: profile.links.filter((_, i) => i !== index),
                          })
                        }
                      >
                        Remove
                      </button>
                      {socialPlatform(link.url) && (
                        <small>{socialPlatform(link.url)?.name}</small>
                      )}
                    </div>
                  </div>
                ))}
                {profile.links.length < 5 && (
                  <button
                    type="button"
                    onClick={() =>
                      change({
                        links: [...profile.links, { label: "", url: "" }],
                      })
                    }
                  >
                    Add custom link
                  </button>
                )}
              </fieldset>
              <fieldset
                id="profile-projects"
                data-section
                hidden={section !== "profile-projects"}
                disabled={busy}
              >
                <legend>Featured work · {profile.highlights.length}/6</legend>
                <small>
                  Put your favorite project first to feature it in your profile
                  card.
                </small>
                {profile.highlights.map((h, index) => (
                  <div
                    className="portfolio-highlight-edit"
                    // biome-ignore lint/suspicious/noArrayIndexKey: Controlled rows have no local state; indexes retain input focus during edits.
                    key={`highlight-${index}`}
                  >
                    {h.kind === "project" ? (
                      <>
                        <div className="portfolio-project-editor-heading">
                          <strong>{h.title || "New project"}</strong>
                          {profile.highlights.findIndex(
                            (item) => item.kind === "project",
                          ) === index && <span>Featured in card</span>}
                        </div>
                        <label>
                          Project title
                          <input
                            required
                            maxLength={80}
                            value={h.title}
                            onChange={(e) =>
                              highlight(index, {
                                ...h,
                                title: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Description
                          <textarea
                            maxLength={240}
                            value={h.description}
                            onChange={(e) =>
                              highlight(index, {
                                ...h,
                                description: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Project link
                          <input
                            type="url"
                            pattern="https?://.*"
                            maxLength={2048}
                            required
                            value={h.url}
                            onChange={(e) =>
                              highlight(index, { ...h, url: e.target.value })
                            }
                          />
                        </label>
                        <div className="portfolio-upload">
                          <ProfileImage id={h.image} alt="" />
                          <label>
                            Project image
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f)
                                  void upload(f, (id) =>
                                    highlight(index, { ...h, image: id }),
                                  );
                                e.target.value = "";
                              }}
                            />
                          </label>
                          {h.image && (
                            <button
                              type="button"
                              onClick={() =>
                                highlight(index, { ...h, image: null })
                              }
                            >
                              Remove image
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <p>{h.text ?? "Featured Pulse post"}</p>
                    )}
                    <div className="portfolio-highlight-controls">
                      <button
                        type="button"
                        disabled={index === 0}
                        aria-label={`Move highlight ${index + 1} up`}
                        onClick={() => reorder(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={index === profile.highlights.length - 1}
                        aria-label={`Move highlight ${index + 1} down`}
                        onClick={() => reorder(index, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          change({
                            highlights: profile.highlights.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                      >
                        Remove highlight
                      </button>
                    </div>
                  </div>
                ))}
                {profile.highlights.length < 6 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        change({
                          highlights: [
                            ...profile.highlights,
                            {
                              kind: "project",
                              title: "",
                              description: "",
                              url: "",
                              image: null,
                            },
                          ],
                        })
                      }
                    >
                      Add project
                    </button>
                    <PulsePicker
                      selected={profile.highlights}
                      onPick={(h) =>
                        change({ highlights: [...profile.highlights, h] })
                      }
                    />
                  </>
                )}
              </fieldset>
            </form>
            <aside
              className="portfolio-editor-preview"
              aria-label="Profile preview"
            >
              <div className="portfolio-preview-heading">
                <h2>Preview</h2>
                {profile.publication_enabled === false && (
                  <span
                    className="portfolio-preview-badge"
                    title="Only you can see this draft."
                  >
                    Draft only
                  </span>
                )}
              </div>
              <ProfileView compact profile={{ ...profile, owner: false }} />
            </aside>
          </div>
        )}
      </div>
      <footer className="portfolio-editor-nav">
        <div>
          <button
            type="button"
            disabled={busy || !profile}
            onClick={() => {
              if (!preview && !validate()) return;
              setPreview((p) => !p);
              requestAnimationFrame(() => {
                editor.current
                  ?.querySelector<HTMLElement>(".portfolio-editor-content")
                  ?.scrollTo({ top: 0, behavior: "instant" });
              });
            }}
          >
            <Eye size={16} aria-hidden="true" />
            {preview ? "Back to editing" : "Preview as visitor"}
          </button>
          <button
            type="button"
            disabled={busy || !profile}
            className="portfolio-save"
            onClick={() => void save()}
          >
            {busy
              ? "Saving…"
              : profile?.publication_enabled === false
                ? "Save draft"
                : "Save profile"}
          </button>
        </div>
        {dirty && (
          <div className="portfolio-draft-status">
            <span role="status" title="Your draft is kept in this tab.">
              Unsaved changes
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setProfile(saved.current);
                setDraft("");
                setNote("");
                setError("");
              }}
            >
              Discard changes
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}
function PulsePicker({
  selected,
  onPick,
}: {
  selected: Highlight[];
  onPick: (h: Highlight) => void;
}) {
  const { identity } = useMembership();
  const { notes, loading } = usePulse(identity?.pubkey ?? "");
  const [id, setId] = useState("");
  const available = notes.filter(
    (n) =>
      n.pubkey === identity?.pubkey &&
      !n.replyTo &&
      !selected.some((h) => h.kind === "pulse" && h.event_id === n.id),
  );
  return (
    <>
      <label>
        Feature one of your Pulse posts
        <select value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">
            {loading ? "Loading your posts…" : "Choose a post"}
          </option>
          {available.map((n) => (
            <option key={n.id} value={n.id}>
              {n.content.slice(0, 90)}
            </option>
          ))}
        </select>
      </label>
      <small>
        Featuring publishes this post outside the community when your profile is
        public. Replies and attachments are excluded. Later edits update it;
        deleting the post removes it.
      </small>
      <button
        type="button"
        disabled={!id}
        onClick={() => {
          const note = available.find((n) => n.id === id);
          if (note) {
            onPick({ kind: "pulse", event_id: note.id, text: note.content });
            setId("");
          }
        }}
      >
        Feature selected post
      </button>
    </>
  );
}
