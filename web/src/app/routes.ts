import { index, route, rootRoute } from "@tanstack/virtual-file-routes";

export const routes = rootRoute("root.tsx", [
  index("index.tsx"),
  route("/chat", "chat.tsx"),
  route("/onboarding", "onboarding.tsx"),
  route("/pulse", "pulse.tsx"),
  route("/live", "live.tsx"),
  route("/inbox", "inbox.tsx"),
  route("/workflows", "workflows.tsx"),
  route("/agents", "agents.tsx"),
  route("/community", "community.tsx"),
  route("/invite/$code", "invite.$code.tsx"),
  route("/repos", "repos.tsx"),
  route("/repos/$repoId", "repos.$repoId.tsx"),
  route("/repos/$repoId/blob/$", "repos.$repoId.blob.$.tsx"),
]);
