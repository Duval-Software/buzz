import {
  Outlet,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import { ManagedAuthGate } from "@/features/identity/ui/ManagedAuthGate";
import { ChannelsProvider } from "@/features/chat/use-chat";

export const Route = createRootRoute({ component: RootLayout });

function RootLayout() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  if (/^\/(?:@|%40)[^/]+\/?$/i.test(path)) return <Outlet />;
  return (
    <ManagedAuthGate>
      <ChannelsProvider>
        <div className="flex min-h-dvh flex-col">
          <main className="flex flex-1 flex-col">
            <Outlet />
          </main>
        </div>
      </ChannelsProvider>
    </ManagedAuthGate>
  );
}
