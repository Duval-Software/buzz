import { createFileRoute } from "@tanstack/react-router";
import { CommunityGate } from "@/features/identity/ui/CommunityGate";
import { LivePage } from "@/features/live/LivePage";

export const Route = createFileRoute("/live")({
  validateSearch: (search: Record<string, unknown>): { preview?: boolean } => ({
    preview:
      search.preview === true || search.preview === "1" ? true : undefined,
  }),
  component: LiveRoute,
});

function LiveRoute() {
  const { preview } = Route.useSearch();
  // Local visual review only. Production always uses the existing member gate.
  if (import.meta.env.DEV && preview) return <LivePage preview />;
  return (
    <CommunityGate>
      <LivePage />
    </CommunityGate>
  );
}
