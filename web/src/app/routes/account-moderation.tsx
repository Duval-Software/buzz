import { createFileRoute } from "@tanstack/react-router";
import { AccountRestrictions } from "@/features/moderation/AccountRestrictions";
export const Route = createFileRoute("/account-moderation")({
  component: AccountRestrictions,
});
