import { Link } from "@tanstack/react-router";

/**
 * The row of community surfaces at the top of the channel sidebar.
 *
 * Chat is where people live; these are the places they visit. Each entry is a
 * real route so the browser back button, deep links, and phone home-screen
 * shortcuts all behave.
 */
export function SurfacesNav({ inboxUnread = 0 }: { inboxUnread?: number }) {
  const item =
    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-neutral-300 text-sm hover:bg-neutral-900";
  return (
    <div className="border-neutral-800 border-b p-2">
      <Link to="/pulse" className={item}>
        <span aria-hidden="true">🐝</span> Pulse
      </Link>
      <Link to="/inbox" className={item}>
        <span aria-hidden="true">📥</span> Inbox
        {inboxUnread > 0 ? (
          <span className="ml-auto rounded-full bg-amber-500 px-1.5 font-semibold text-neutral-950 text-xs">
            {inboxUnread > 9 ? "9+" : inboxUnread}
          </span>
        ) : null}
      </Link>
      <Link to="/workflows" className={item}>
        <span aria-hidden="true">⚡</span> Workflows
      </Link>
      <Link to="/agents" className={item}>
        <span aria-hidden="true">🤖</span> Agents
      </Link>
    </div>
  );
}
