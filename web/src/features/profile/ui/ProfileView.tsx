import { ProfileEditButton } from "./ProfileEditButton";
import { useEffect, useId, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ArrowUpRight, Hammer, Link as LinkIcon } from "lucide-react";
import { accents, profileFetch, type PublicProfile } from "../public-profile";
import { interests } from "@/features/onboarding/member-profile";
import { socialPlatform } from "../social-platforms";
import "../public-profile.css";

/** Images never bypass current server visibility checks, including in editor previews. */
export function ProfileImage({
  id,
  alt,
  className = "",
  anonymous = false,
}: {
  id: string | null;
  alt: string;
  className?: string;
  anonymous?: boolean;
}) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    let url = "";
    setSrc("");
    if (id)
      void profileFetch(
        `profile-images/${encodeURIComponent(id)}`,
        {},
        anonymous,
      )
        .then((r) => r.blob())
        .then((b) => {
          if (active) {
            url = URL.createObjectURL(b);
            setSrc(url);
          }
        })
        .catch(() => {});
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, anonymous]);
  return src ? <img src={src} alt={alt} className={className} /> : null;
}
export function ProfileView({
  profile,
  anonymous = false,
  compact = false,
  actions,
  avatar,
  presence,
}: {
  profile: PublicProfile;
  anonymous?: boolean;
  compact?: boolean;
  actions?: ReactNode;
  avatar?: ReactNode;
  presence?: ReactNode;
}) {
  const projects = profile.highlights.filter((h) => h.kind === "project");
  const notes = profile.highlights.filter((h) => h.kind === "pulse");
  const hasWork = !!(projects.length || profile.build_status?.trim());
  const tabs = [
    ...(hasWork ? ["Work"] : []),
    ...(notes.length ? ["Pulse"] : []),
    "About",
  ];
  const [selected, setSelected] = useState(hasWork ? "Work" : "About");
  const active = tabs.includes(selected) ? selected : "About";
  const id = useId();
  const about = (
    <>
      {profile.bio && <p className="portfolio-bio">{profile.bio}</p>}
      {profile.collaborating && (
        <p className="portfolio-available">
          <span />
          Open to collaborating
        </p>
      )}
      {!compact && !!profile.interests.length && (
        <ul className="portfolio-interests" aria-label="Interests">
          {profile.interests.map((interest) => (
            <li key={interest}>
              {interests.find(([key]) => key === interest)?.[1] ?? interest}
            </li>
          ))}
        </ul>
      )}
    </>
  );
  const connections = !!profile.links.length && (
    <div className="portfolio-links">
      {profile.links.map((link) => {
        const platform = socialPlatform(link.url);
        return (
          <a
            key={`${link.url}-${link.label}`}
            href={safeLink(link.url)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {platform ? (
              <span
                className="portfolio-social-mark"
                style={{ background: platform.color }}
                aria-hidden="true"
              >
                {platform.mark}
              </span>
            ) : (
              <LinkIcon size={14} />
            )}
            {link.label}
            <ArrowUpRight size={14} />
          </a>
        );
      })}
    </div>
  );
  const building = profile.build_status?.trim() && (
    <div className="portfolio-building">
      <div className="portfolio-building-label">
        <Hammer size={14} />
        <span>Currently building</span>
      </div>
      {profile.build_url && safeLink(profile.build_url) ? (
        <a
          href={safeLink(profile.build_url)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {profile.build_status}
          <ArrowUpRight size={16} />
        </a>
      ) : (
        <p>{profile.build_status}</p>
      )}
    </div>
  );
  return (
    <section
      className={`portfolio ${compact ? "portfolio-compact" : "portfolio-expanded"}`}
      style={
        {
          "--profile-accent": accents[profile.accent] ?? accents.honey,
        } as CSSProperties
      }
    >
      <div className="portfolio-identity">
        <div className="portfolio-cover">
          <span className="portfolio-cover-mark" aria-hidden="true">
            ✳
          </span>
          <ProfileImage id={profile.cover} alt="" anonymous={anonymous} />
        </div>
        <div className="portfolio-content">
          <div className="portfolio-avatar-wrap">
            <div className="portfolio-avatar">
              {avatar ?? <span>{profile.display_name[0]?.toUpperCase()}</span>}
              <ProfileImage id={profile.avatar} alt="" anonymous={anonymous} />
            </div>
            {presence && <span className="portfolio-presence">{presence}</span>}
          </div>
          <h1>{profile.display_name}</h1>
          {profile.username && (
            <p className="portfolio-handle">@{profile.username}</p>
          )}
          {profile.owner && profile.username && !profile.published && (
            <p className="portfolio-draft">Only you can see this draft</p>
          )}
          {compact && (
            <>
              {about}
              {connections}
              {projects[0] && (
                <a
                  className="portfolio-featured"
                  href={safeLink(projects[0].url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {projects[0].image && (
                    <div className="portfolio-featured-image">
                      <ProfileImage
                        id={projects[0].image}
                        alt=""
                        anonymous={anonymous}
                      />
                    </div>
                  )}
                  <span>
                    <small>Featured project</small>
                    <strong>{projects[0].title}</strong>
                  </span>
                  <ArrowUpRight size={18} />
                </a>
              )}
            </>
          )}
          {!compact && connections}
          {actions && <div className="portfolio-actions">{actions}</div>}
        </div>
      </div>
      {!compact && (
        <div className="portfolio-details">
          <div
            className="portfolio-tabs"
            role="tablist"
            aria-label="Profile sections"
          >
            {tabs.map((tab, index) => (
              <button
                key={tab}
                id={`${id}-${tab}`}
                type="button"
                role="tab"
                aria-selected={active === tab}
                aria-controls={`${id}-panel`}
                tabIndex={active === tab ? 0 : -1}
                onClick={() => setSelected(tab)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % tabs.length
                      : event.key === "ArrowLeft"
                        ? (index + tabs.length - 1) % tabs.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? tabs.length - 1
                            : null;
                  if (next === null) return;
                  event.preventDefault();
                  setSelected(tabs[next]);
                  document.getElementById(`${id}-${tabs[next]}`)?.focus();
                }}
              >
                {tab}
                {tab !== "About" && (
                  <span>
                    {tab === "Work" ? projects.length || "" : notes.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div
            id={`${id}-panel`}
            className="portfolio-tab-panel"
            role="tabpanel"
            aria-labelledby={`${id}-${active}`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: tab panels need a focus target when their content has no links.
            tabIndex={0}
          >
            {active === "About" && (
              <>
                <h2>About {profile.display_name.split(" ")[0]}</h2>
                {about}
                {profile.owner &&
                  !profile.bio &&
                  !profile.interests.length &&
                  !profile.links.length && (
                    <ProfileEditButton className="portfolio-edit-prompt">
                      Add a little about yourself
                    </ProfileEditButton>
                  )}
              </>
            )}
            {active === "Work" && (
              <>
                {building}
                <div className="portfolio-section-title">
                  <h2>Featured projects</h2>
                </div>
                {projects.length ? (
                  <div className="portfolio-grid">
                    {projects.map((h, index) => (
                      <article
                        className="portfolio-project"
                        key={`${h.title}-${h.url}`}
                      >
                        {h.image ? (
                          <div className="portfolio-project-image">
                            <ProfileImage
                              id={h.image}
                              alt={h.title}
                              anonymous={anonymous}
                            />
                          </div>
                        ) : (
                          <div
                            className="portfolio-project-type"
                            aria-hidden="true"
                          >
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            <ArrowUpRight size={22} />
                          </div>
                        )}
                        <h3>
                          <a
                            href={safeLink(h.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {h.title}
                            <ArrowUpRight size={16} />
                          </a>
                        </h3>
                        {h.description && <p>{h.description}</p>}
                      </article>
                    ))}
                  </div>
                ) : (
                  profile.owner && (
                    <ProfileEditButton className="portfolio-edit-prompt">
                      Add your first project
                    </ProfileEditButton>
                  )
                )}
              </>
            )}
            {active === "Pulse" && (
              <>
                <h2>From Pulse</h2>
                <div className="portfolio-notes">
                  {notes.map((h) => (
                    <article key={h.event_id} className="portfolio-note">
                      <p>
                        {h.text ??
                          "Selected Pulse post — the published profile shows its current text."}
                      </p>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
function safeLink(value: string) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
