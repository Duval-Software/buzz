/** Social shortcuts use the existing label + URL fields, so saved links remain portable. */
export const socialPlatforms = [
  {
    name: "Twitch",
    hosts: ["twitch.tv"],
    example: "https://twitch.tv/yourname",
    mark: "T",
    color: "#9146ff",
  },
  {
    name: "YouTube",
    hosts: ["youtube.com", "youtu.be"],
    example: "https://youtube.com/@yourname",
    mark: "▶",
    color: "#e52222",
  },
  {
    name: "X / Twitter",
    hosts: ["x.com", "twitter.com"],
    example: "https://x.com/yourname",
    mark: "𝕏",
    color: "#34383c",
  },
  {
    name: "Instagram",
    hosts: ["instagram.com"],
    example: "https://instagram.com/yourname",
    mark: "IG",
    color: "#b63278",
  },
  {
    name: "TikTok",
    hosts: ["tiktok.com"],
    example: "https://tiktok.com/@yourname",
    mark: "♪",
    color: "#34383c",
  },
  {
    name: "GitHub",
    hosts: ["github.com"],
    example: "https://github.com/yourname",
    mark: "GH",
    color: "#34383c",
  },
  {
    name: "LinkedIn",
    hosts: ["linkedin.com"],
    example: "https://linkedin.com/in/yourname",
    mark: "in",
    color: "#0a66c2",
  },
  {
    name: "Discord",
    hosts: ["discord.com", "discord.gg"],
    example: "https://discord.gg/yourinvite",
    mark: "D",
    color: "#5865f2",
  },
] as const;

/** Derive platform identity from the destination, never from a member-provided label. */
export function socialPlatform(url: string) {
  try {
    const parsed = new URL(url);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      return undefined;
    const host = parsed.hostname.replace(/^www\./, "");
    return socialPlatforms.find((platform) =>
      platform.hosts.some((domain) => host === domain),
    );
  } catch {
    return undefined;
  }
}
