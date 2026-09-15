import { ProfileEditButton } from "./ProfileEditButton";
import { useRef, useState } from "react";
import { CommunityDialog } from "@/features/surfaces/ui/CommunityDialog";
import { useNavigate, Link } from "@tanstack/react-router";
import { Ellipsis, MessageCircle, ArrowUpRight } from "lucide-react";
import type { PublicProfile } from "../public-profile";

/** Privileged actions load their signing dependencies only after a member asks. */
export function ProfileActions({
  profile,
  compact = false,
  onExpand,
  onNavigate,
}: {
  profile: PublicProfile;
  compact?: boolean;
  onExpand?: () => void;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const menu = useRef<HTMLDetailsElement>(null);
  const [note, setNote] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState("other");
  const [busy, setBusy] = useState(false);
  async function message() {
    setBusy(true);
    setNote("");
    try {
      if (!profile.member_key) {
        window.location.assign("/chat");
        return;
      }
      await prepareAction();
      const { openDm } = await import("@/features/dm/open-dm");
      const id = await openDm([profile.member_key]);
      await navigate({ to: "/chat", search: { channel: id } });
      onNavigate?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not open conversation.");
    } finally {
      setBusy(false);
    }
  }
  async function report() {
    setBusy(true);
    setNote("");
    try {
      if (!profile.member_key)
        throw new Error("Sign in to report this profile.");
      await prepareAction();
      const { signNostrEvent } = await import("@/shared/lib/nostr-signer");
      const { getSocket } = await import("@/shared/lib/nostr-socket");
      const { relayWsUrl } = await import("@/shared/lib/relay-url");
      const event = await signNostrEvent({
        kind: 1984,
        content: `Profile ${profile.username ? `@${profile.username}` : profile.display_name}: ${reason.trim()}`,
        tags: [["p", profile.member_key, category]],
      });
      const result = await getSocket(relayWsUrl()).publish(event);
      if (!result.accepted)
        throw new Error(result.reason || "Report could not be submitted.");
      setReporting(false);
      setNote("Report sent to the moderation team.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not send report.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {profile.owner ? (
        profile.username ? (
          <ProfileEditButton className="portfolio-primary">
            Edit profile
          </ProfileEditButton>
        ) : (
          <Link
            className="portfolio-primary"
            to="/onboarding"
            onClick={onNavigate}
          >
            Set up profile
          </Link>
        )
      ) : (
        <button
          className={
            compact && profile.member_key
              ? "portfolio-message"
              : "portfolio-primary"
          }
          type="button"
          disabled={busy}
          onClick={() => void message()}
        >
          <MessageCircle size={15} />
          {profile.member_key
            ? compact
              ? `Message ${profile.username ? `@${profile.username}` : profile.display_name}`
              : "Message"
            : "Sign in to connect"}
        </button>
      )}
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          aria-label="View profile"
          title="View profile"
        >
          {!compact && "View profile"}
          <ArrowUpRight size={15} />
        </button>
      )}
      {(profile.published || !profile.owner) && (
        <details
          className="portfolio-menu"
          ref={menu}
          onKeyDown={(e) => {
            if (e.key === "Escape" && menu.current?.open) {
              e.preventDefault();
              e.stopPropagation();
              menu.current.open = false;
              menu.current.querySelector("summary")?.focus();
            }
          }}
        >
          <summary aria-label="More profile actions">
            <Ellipsis size={18} />
          </summary>
          <div>
            {profile.published && profile.username && (
              <button
                type="button"
                onClick={() => {
                  if (menu.current) menu.current.open = false;
                  void navigator.clipboard
                    .writeText(`${window.location.origin}/@${profile.username}`)
                    .then(() => setNote("Profile link copied."))
                    .catch(() =>
                      setNote(
                        `Copy this link: ${window.location.origin}/@${profile.username}`,
                      ),
                    );
                }}
              >
                Share profile
              </button>
            )}
            {!profile.owner && (
              <button
                type="button"
                onClick={() => {
                  if (menu.current) menu.current.open = false;
                  profile.member_key
                    ? setReporting(true)
                    : window.location.assign("/chat");
                }}
              >
                Report profile
              </button>
            )}
          </div>
        </details>
      )}
      {note && <p role="status">{note}</p>}
      {reporting && (
        <CommunityDialog
          label="Report profile"
          onClose={() => setReporting(false)}
          busy={busy}
        >
          <form
            className="portfolio-form"
            onSubmit={(e) => {
              e.preventDefault();
              void report();
            }}
          >
            <label>
              Reason
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="other">Other</option>
                <option value="impersonation">Impersonation</option>
                <option value="spam">Spam</option>
                <option value="illegal">Illegal content</option>
              </select>
            </label>
            <label>
              Details
              <textarea
                maxLength={1800}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button disabled={busy} type="submit">
              {busy ? "Sending…" : "Send report"}
            </button>
            {note && <p role="alert">{note}</p>}
          </form>
        </CommunityDialog>
      )}
    </>
  );
}

/** Public routes do not bootstrap chat. Do so only for an explicit member action. */
async function prepareAction() {
  const { supabase } = await import("@/shared/lib/supabase");
  const session = (await supabase?.auth.getSession())?.data.session;
  if (!session) throw new Error("Please sign in to continue.");
  const { bootstrapManagedAccount } = await import(
    "@/features/identity/managed-accounts"
  );
  let current = true;
  const subscription = supabase?.auth.onAuthStateChange((_event, next) => {
    if (next?.access_token !== session.access_token) current = false;
  });
  try {
    await bootstrapManagedAccount(session, () => current);
  } finally {
    subscription?.data.subscription.unsubscribe();
  }
  if (!current) throw new Error("Your session changed. Please retry.");
  const { getSocket } = await import("@/shared/lib/nostr-socket");
  const { relayWsUrl } = await import("@/shared/lib/relay-url");
  const result = await getSocket(relayWsUrl()).waitForAuth(6000);
  if (result.state !== "accepted")
    throw new Error("Could not connect. Please retry.");
}
