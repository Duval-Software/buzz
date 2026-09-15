import { createFileRoute } from "@tanstack/react-router";
import { PublicProfilePage } from "@/features/profile/ui/PublicProfilePage";
export const Route = createFileRoute("/$profileHandle")({ component: Page });
function Page() {
  const { profileHandle } = Route.useParams();
  return (
    <PublicProfilePage
      username={profileHandle.startsWith("@") ? profileHandle.slice(1) : ""}
    />
  );
}
