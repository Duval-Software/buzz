import { loadIdentity, subscribeIdentity } from "@/shared/lib/identity";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/app/App";
import { registerServiceWorker } from "@/features/notifications/push-client";
import "@fontsource-variable/inter/wght.css";
import "@/shared/styles/globals.css";
import "@/shared/styles/community.css";
import { ThemeProvider } from "@/shared/theme/ThemeProvider";
import { Toaster } from "@/shared/ui/sonner";
import { TooltipProvider } from "@/shared/ui/tooltip";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      networkMode: "always",
      gcTime: 5 * 60 * 1_000,
    },
    mutations: {
      networkMode: "always",
    },
  },
});

// Cached private queries must not survive an account change on a shared browser.
let activePubkey = loadIdentity()?.pubkey;
subscribeIdentity(() => {
  const next = loadIdentity()?.pubkey;
  if (next !== activePubkey) {
    activePubkey = next;
    queryClient.clear();
  }
});

// Register the worker on load so the app is installable and a returning member
// who already granted permission keeps receiving pushes. Asking for permission
// is NOT done here — that only happens from a real click in settings.
void registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={300}>
          <App />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
