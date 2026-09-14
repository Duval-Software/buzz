import { RouterProvider } from "@tanstack/react-router";

import { ChannelsProvider } from "@/features/chat/use-chat";

import { router } from "@/app/router";

export function App() {
  return (
    <ChannelsProvider>
      <RouterProvider router={router} />
    </ChannelsProvider>
  );
}
