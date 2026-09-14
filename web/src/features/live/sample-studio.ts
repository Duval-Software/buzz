/** Local rehearsal only: no network, real balances, or device execution. */
export const actions = [
  {
    id: "amber",
    name: "Hive lights",
    detail: "Amber lighting preset · 30 seconds",
    cost: 120,
    icon: "light",
  },
  {
    id: "chime",
    name: "Ship it sound",
    detail: "Approved chime · 3 seconds · volume capped at 20%",
    cost: 80,
    icon: "sound",
  },
  {
    id: "wave",
    name: "Desk robot wave",
    detail: "Stationary wave · approved motion",
    cost: 180,
    icon: "robot",
  },
  {
    id: "challenge",
    name: "Challenge wheel",
    detail: "One of 5 approved coding challenges",
    cost: 240,
    icon: "wheel",
  },
  {
    id: "camera",
    name: "Workbench camera",
    detail: "Approved preset · returns after 15 seconds",
    cost: 160,
    icon: "camera",
  },
  {
    id: "water",
    name: "Water break",
    detail: "A gentle on-screen hydration reminder",
    cost: 40,
    icon: "water",
  },
] as const;

export const roadmap = [
  {
    id: "replay",
    title: "Replay the moment it shipped",
    description: "Jump from a release to the exact moment on stream.",
    votes: 128,
    stage: "Next build",
  },
  {
    id: "notes",
    title: "A shared build notebook",
    description: "Keep decisions, sketches, and experiments with each project.",
    votes: 96,
    stage: "Exploring",
  },
  {
    id: "captions",
    title: "Searchable stream transcripts",
    description: "Find the explanation you remember, in any episode.",
    votes: 74,
    stage: "Exploring",
  },
] as const;

export type StudioState = {
  points: number;
  credits: number;
  votes: number;
  voted: string[];
  paused: boolean;
  cooldownUntil: number;
  message: string;
  queue: {
    id: string;
    name: string;
    cost: number;
    due: number;
    fail: boolean;
  } | null;
  last: string;
};
export const initialStudio: StudioState = {
  points: 300,
  credits: 4,
  votes: 3,
  voted: [],
  paused: false,
  cooldownUntil: 0,
  message: "",
  queue: null,
  last: "The studio is ready for your next idea.",
};
export type StudioEvent =
  | { type: "vote"; id: string }
  | { type: "queue"; id: string; now: number; fail: boolean }
  | { type: "settle"; now: number }
  | { type: "pause" }
  | { type: "reset" }
  | { type: "empty" };

/** Rehearses responses expected from an authoritative service; never a security gate. */
export function studioReducer(
  state: StudioState,
  event: StudioEvent,
): StudioState {
  switch (event.type) {
    case "reset":
      return { ...initialStudio };
    case "empty":
      return {
        ...state,
        points: 0,
        credits: 0,
        votes: 0,
        message: "Preview balances emptied.",
      };
    case "vote": {
      if (!roadmap.some((item) => item.id === event.id))
        return { ...state, message: "This proposal is unavailable." };
      if (state.voted.includes(event.id))
        return { ...state, message: "You already voted for this idea." };
      if (state.votes < 1)
        return {
          ...state,
          message:
            "No vote credits left. Your next monthly allocation will refresh them.",
        };
      return {
        ...state,
        votes: state.votes - 1,
        voted: [...state.voted, event.id],
        message: "Vote counted in this preview.",
        last: "Your vote is part of the next build.",
      };
    }
    case "queue": {
      const action = actions.find((item) => item.id === event.id);
      if (!action) return { ...state, message: "This action is unavailable." };
      if (state.paused)
        return { ...state, message: "The studio is paused by staff." };
      if (state.queue)
        return {
          ...state,
          message: "An action is already queued. Wait for it to finish.",
        };
      if (event.now < state.cooldownUntil)
        return {
          ...state,
          message: "The studio is cooling down. Try again shortly.",
        };
      if (state.points < action.cost)
        return {
          ...state,
          message: `Not enough points. ${action.name} needs ${action.cost} points.`,
        };
      if (state.credits < 1)
        return { ...state, message: "No interaction credits left this month." };
      return {
        ...state,
        points: state.points - action.cost,
        credits: state.credits - 1,
        cooldownUntil: event.now + 20_000,
        queue: {
          id: action.id,
          name: action.name,
          cost: action.cost,
          due: event.now + 3_000,
          fail: event.fail,
        },
        message: `${action.name} queued. ${action.cost} points and 1 interaction credit reserved.`,
      };
    }
    case "settle": {
      const pending = state.queue;
      if (!pending || event.now < pending.due) return state;
      return {
        ...state,
        queue: null,
        points: state.points + (pending.fail ? pending.cost : 0),
        credits: state.credits + (pending.fail ? 1 : 0),
        message: pending.fail
          ? `${pending.name} failed. Points and credit returned.`
          : `${pending.name} complete in preview. No hardware was activated.`,
        last: pending.fail
          ? `${pending.name} could not run.`
          : `You sent ${pending.name.toLowerCase()} to the studio.`,
      };
    }
    case "pause":
      return {
        ...state,
        paused: !state.paused,
        queue: null,
        points: state.points + (state.queue?.cost ?? 0),
        credits: state.credits + (state.queue ? 1 : 0),
        message: state.paused
          ? "Preview studio resumed."
          : "Studio paused. Queued actions cancelled and refunded.",
      };
  }
}

export type BroadcastStatus = "live" | "upcoming" | "offline";
export type Provider = "youtube" | "twitch";

/** Only provider identifiers enter URLs; arbitrary embed URLs are never accepted. */
export function embedUrl(
  provider: Provider,
  id: string,
  parent: string,
): string | null {
  if (provider === "youtube")
    return /^[\w-]{11}$/.test(id)
      ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=0`
      : null;
  if (
    !/^[a-zA-Z0-9_]{1,25}$/.test(id) ||
    !/^(localhost|[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)$/.test(parent)
  )
    return null;
  const params = new URLSearchParams({
    channel: id,
    parent,
    autoplay: "false",
    muted: "true",
  });
  return `https://player.twitch.tv/?${params}`;
}

// This feed is authored, safe fixture text. Real output must be redacted BEFORE delivery.
export const terminalLines = [
  ["18:42:01", "build", "Preparing the member release…"],
  ["18:42:03", "pass", "Playback bookmarks keep their place"],
  ["18:42:04", "pass", "Keyboard navigation follows the build"],
  ["18:42:06", "pass", "Private values removed from broadcast output"],
  ["18:42:09", "ready", "Preview is ready for member feedback"],
];
