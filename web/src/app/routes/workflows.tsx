import { createFileRoute } from "@tanstack/react-router";
import { CommunityGate } from "@/features/identity/ui/CommunityGate";
import { WorkflowsPage } from "@/features/workflows/ui/WorkflowsPage";

export const Route = createFileRoute("/workflows")({
  component: () => (
    <CommunityGate>
      <WorkflowsPage />
    </CommunityGate>
  ),
});
