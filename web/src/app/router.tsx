import { createBrowserHistory, createRouter } from "@tanstack/react-router";

import { routeTree } from "@/app/routeTree.gen";
import { HiveLoading } from "@/shared/ui/HiveLoading";

export const router = createRouter({
  routeTree,
  history: createBrowserHistory(),
  scrollRestoration: true,
  defaultPendingMs: 150,
  defaultPendingMinMs: 150,
  defaultPendingComponent: HiveLoading,
  defaultErrorComponent: () => (
    <div className="hive-app hive-entry">
      <div>
        <p role="alert">This page couldn’t load. Please reload to try again.</p>
        <button
          type="button"
          className="hive-primary-button mt-4"
          onClick={() => window.location.reload()}
        >
          Reload page
        </button>
      </div>
    </div>
  ),
  getScrollRestorationKey: (location: { pathname: string }) =>
    location.pathname,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
