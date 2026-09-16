import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, Inbox } from "lucide-react";

/** Shared community identity for navigation and onboarding. */
export function HiveBrand({
  channel,
  onNavigate,
}: {
  channel?: string;
  onNavigate?: () => void;
} = {}) {
  return (
    <Link
      to="/chat"
      onClick={onNavigate}
      search={channel ? { channel } : {}}
      className="hive-brand"
      aria-label="CreatorHive home"
    >
      <img
        className="hive-brand-mark"
        src="/creatorhive-logo.png"
        alt=""
        width={40}
        height={40}
      />
      <span>
        Creator<span className="hive-brand-light">Hive</span>
        <small
          title={`Frontend ${__CREATORHIVE_BUILD__.commit} · ${__CREATORHIVE_BUILD__.backend}`}
        >
          {__CREATORHIVE_BUILD__.environment === "development"
            ? `${import.meta.env.DEV ? "LOCAL DEV" : __CREATORHIVE_BUILD__.branch === "review" ? "REVIEW" : "SHARED DEV"} · ${__CREATORHIVE_BUILD__.commit.slice(0, 7)}`
            : "BUILD TOGETHER"}
        </small>
      </span>
    </Link>
  );
}

/** Primary destinations; announcements stays between personal and community activity. */
export function SurfacesNav({
  inboxUnread = 0,
  children,
  onNavigate,
}: {
  inboxUnread?: number;
  children: ReactNode;
  onNavigate: () => void;
}) {
  return (
    <nav className="hive-navigation" aria-label="Community">
      <Link
        onClick={onNavigate}
        to="/inbox"
        className="hive-nav-link"
        activeProps={{ className: "is-active", "aria-current": "page" }}
      >
        <Inbox size={17} aria-hidden="true" />
        <span>Inbox</span>
        {inboxUnread > 0 && (
          <span className="hive-unread">
            {inboxUnread > 9 ? "9+" : inboxUnread}
          </span>
        )}
      </Link>
      {children}
      <Link
        onClick={onNavigate}
        to="/pulse"
        className="hive-nav-link"
        activeProps={{ className: "is-active", "aria-current": "page" }}
      >
        <Activity size={17} aria-hidden="true" />
        <span>Pulse</span>
      </Link>
    </nav>
  );
}
