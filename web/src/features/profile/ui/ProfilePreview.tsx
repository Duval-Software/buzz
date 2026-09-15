import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import {
  searchProfileMembers,
  readPublicProfile,
  ownPublicProfile,
  type PublicProfile,
} from "../public-profile";
import { ProfileView } from "./ProfileView";
import { ProfileActions } from "./ProfileActions";
import { loadIdentity } from "@/shared/lib/identity";
import { useProfile } from "../use-profiles";
import { AvatarDisc } from "./AvatarDisc";
import { PresenceDot } from "@/features/chat/ui/PresenceDot";
import type { PresenceStatus } from "@/features/chat/use-presence";

/** Resolve claimed handles server-side; kind:0 metadata cannot impersonate a claimed name. */
export function ProfilePreview({
  pubkey,
  name,
  status,
  children,
}: {
  pubkey: string;
  name: string;
  status?: PresenceStatus;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const member = useProfile(pubkey);
  const owner = loadIdentity()?.pubkey === pubkey;
  // Chat identity stays useful before a member publishes a separate public profile.
  // Never treat a kind:0 name as a server-claimed username.
  const identity: PublicProfile = profile ?? {
    display_name: member?.displayName ?? name,
    bio: member?.about ?? "",
    username: "",
    avatar: null,
    cover: null,
    accent: "honey",
    interests: [],
    links: [],
    highlights: [],
    collaborating: false,
    published: false,
    visibility: "members",
    member_key: pubkey,
    owner,
  };
  useLayoutEffect(() => {
    if (!open) return;
    const panel = dialog.current;
    panel?.showModal();
    return () => panel?.close();
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !dialog.current) return;
    const panel = dialog.current;
    function position() {
      if (expanded || window.innerWidth < 640) {
        panel.style.removeProperty("left");
        panel.style.removeProperty("top");
        return;
      }
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = panel.offsetWidth;
      const left =
        anchor.right + 12 + width <= window.innerWidth - 12
          ? anchor.right + 12
          : anchor.left - width - 12;
      panel.style.left = `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`;
      panel.style.top = `${Math.max(12, Math.min(anchor.top - 24, window.innerHeight - panel.offsetHeight - 12))}px`;
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, expanded]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry repeats the profile read.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setProfile(null);
    setError("");
    async function load() {
      try {
        let next: PublicProfile;
        if (owner) {
          next = {
            ...(await ownPublicProfile()),
            owner: true,
            member_key: pubkey,
          };
        } else {
          const results = await searchProfileMembers(pubkey);
          if (!active) return;
          if (!results[0])
            throw new Error("This member hasn’t published a profile yet.");
          next = await readPublicProfile(results[0].username);
        }
        if (active) setProfile(next);
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "Profile unavailable.");
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [open, pubkey, owner, retry]);
  function close() {
    dialog.current?.close();
    setOpen(false);
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="profile-trigger"
        aria-label={`View ${name}’s profile`}
        aria-haspopup="dialog"
        onClick={() => {
          setExpanded(false);
          setProfile(null);
          setError("");
          setOpen(true);
        }}
      >
        {children}
      </button>
      {open && (
        <dialog
          ref={dialog}
          className={`hive-app profile-dialog ${expanded ? "profile-dialog-expanded" : "profile-dialog-card"}`}
          aria-label={`${name}’s profile`}
          onKeyDown={(event) => event.stopPropagation()}
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            const rect = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < rect.left ||
              e.clientX > rect.right ||
              e.clientY < rect.top ||
              e.clientY > rect.bottom
            )
              close();
          }}
        >
          <button
            className="profile-close"
            type="button"
            aria-label="Close profile"
            onClick={close}
          >
            <X size={18} />
          </button>
          <ProfileView
            key={identity.username}
            profile={identity}
            compact={!expanded}
            avatar={
              !profile?.avatar ? (
                <AvatarDisc
                  pubkey={pubkey}
                  name={identity.display_name}
                  size={96}
                />
              ) : undefined
            }
            presence={status ? <PresenceDot status={status} /> : undefined}
            actions={
              <>
                <ProfileActions
                  profile={identity}
                  compact={!expanded}
                  onExpand={
                    expanded || !profile ? undefined : () => setExpanded(true)
                  }
                  onNavigate={close}
                />
                {!profile && (
                  <p className="portfolio-fetch-status" role="status">
                    <span>{error || "Loading profile…"}</span>
                    {error && (
                      <button
                        type="button"
                        onClick={() => setRetry((n) => n + 1)}
                      >
                        Retry
                      </button>
                    )}
                  </p>
                )}
              </>
            }
          />
        </dialog>
      )}
    </>
  );
}
