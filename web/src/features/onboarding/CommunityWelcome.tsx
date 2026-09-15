import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useMembership } from "@/features/identity/use-identity";
import { useChannels } from "@/features/chat/use-chat";
import { relayWsUrl } from "@/shared/lib/relay-url";

const channelWords: Record<string, string[]> = {
  vibe_coding: ["vibe", "build", "developer"],
  software: ["developer", "engineering", "software"],
  ai_ml: ["ai", "machine", "agent"],
  design: ["design"],
  content: ["content", "creator"],
  hardware: ["hardware", "robot"],
  business: ["business", "founder"],
  exploring: ["intro", "welcome"],
};

/** A private, dismissible welcome. It creates no chat event or channel subscription. */
export function CommunityWelcome() {
  const { identity } = useMembership();
  const { channels } = useChannels();
  const key = `creatorhive.welcome:${relayWsUrl()}:${identity?.pubkey}`;
  const [welcome, setWelcome] = useState<{
    name: string;
    interests: string[];
  } | null>(() => {
    try {
      const data = JSON.parse(sessionStorage.getItem(key) ?? "null");
      return typeof data?.name === "string" && Array.isArray(data.interests)
        ? data
        : null;
    } catch {
      return null;
    }
  });
  if (!welcome) return null;
  const words = welcome.interests.flatMap((id) => channelWords[id] ?? []);
  const general = channels.find(
    (c) =>
      c.kind === "channel" &&
      c.name.toLowerCase() === "general" &&
      c.postingPolicy !== "admins",
  );
  const recommended = channels
    .filter(
      (c) =>
        c.kind === "channel" &&
        c.id !== general?.id &&
        words.some((word) => c.name.toLowerCase().includes(word)),
    )
    .slice(0, 3);
  return (
    <aside className="hive-private-welcome" aria-label="Your private welcome">
      <button
        type="button"
        aria-label="Dismiss welcome"
        onClick={() => {
          setWelcome(null);
          try {
            sessionStorage.removeItem(key);
          } catch {
            /* Optional browser state. */
          }
        }}
      >
        <X size={16} />
      </button>
      <p className="hive-eyebrow">JUST FOR YOU</p>
      <h2>Welcome to the Hive, {welcome.name}.</h2>
      <p>
        {general
          ? "Say hello in General when you’re ready."
          : "Find a conversation or catch up on what members are building."}
      </p>
      <nav aria-label="Suggested first stops">
        {general && (
          <Link to="/chat" search={{ channel: general.id }}>
            Say hello in #{general.name}
          </Link>
        )}
        {recommended.map((c) => (
          <Link key={c.id} to="/chat" search={{ channel: c.id }}>
            #{c.name}
          </Link>
        ))}
        <Link to="/live">Visit the live studio ↗</Link>
        <Link to="/pulse">Catch up in Pulse ↗</Link>
      </nav>
    </aside>
  );
}
