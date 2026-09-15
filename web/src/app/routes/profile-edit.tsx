import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/profile/edit")({
  beforeLoad: () => {
    throw redirect({ to: "/chat", search: {} });
  },
});
