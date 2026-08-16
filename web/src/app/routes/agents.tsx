import { createFileRoute } from "@tanstack/react-router";
import { CommunityGate } from "@/features/identity/ui/CommunityGate";
import { AgentsPage } from "@/features/agents/ui/AgentsPage";

export const Route = createFileRoute("/agents")({
  component: () => (
    <CommunityGate>
      <AgentsPage />
    </CommunityGate>
  ),
});
