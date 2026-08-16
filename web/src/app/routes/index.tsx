import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The front door is the community, not the repo list.
 *
 * Upstream renders the repo browser here, which for a chat-first community
 * greets a first-time visitor with "This community is empty" and an invitation
 * to go install the desktop app. That is the exact opposite of what
 * app.creatorhive.ai is for, and it is what anyone typing the bare domain or
 * following an old link lands on.
 *
 * The repo browser is still reachable at /repos, which renders the same page,
 * so nothing is lost by sending / to the app.
 */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/chat" });
  },
});
