import { Link } from "@tanstack/react-router";
import {
  BellRing,
  Bot,
  Camera,
  Check,
  ChevronUp,
  Lightbulb,
  RotateCw,
  Terminal,
  Volume2,
  ArrowUpRight,
} from "lucide-react";
import { useEffect, useReducer, useState } from "react";
import { CommunityPage } from "@/features/surfaces/ui/CommunityShell";
import { Broadcast } from "./Broadcast";
import {
  actions,
  initialStudio,
  roadmap,
  studioReducer,
  terminalLines,
  type BroadcastStatus,
  type Provider,
} from "./sample-studio";
import "./live.css";

const icons = {
  light: Lightbulb,
  sound: Volume2,
  robot: Bot,
  wheel: RotateCw,
  camera: Camera,
  water: BellRing,
};
const conversation = [
  {
    name: "Maya",
    initials: "MA",
    time: "18:41",
    text: "Could the replay open right at the commit? That would make catching up so much easier.",
  },
  {
    name: "Cole",
    initials: "CO",
    time: "18:42",
    text: "Exactly what we’re exploring today. Watch the build log →",
    host: true,
  },
  {
    name: "Jules",
    initials: "JU",
    time: "18:43",
    text: "Voted for replay bookmarks. I keep a whole notebook of timestamps right now.",
  },
  {
    name: "Alex",
    initials: "AL",
    time: "18:44",
    text: "The best part is seeing the decisions before the polished release.",
  },
];

function reveal(id: string) {
  const section = document.getElementById(id);
  section?.focus({ preventScroll: true });
  section?.scrollIntoView({ block: "start" });
}

export function LivePage({ preview = false }: { preview?: boolean }) {
  const [studio, dispatch] = useReducer(studioReducer, initialStudio);
  const [panel, setPanel] = useState<"roadmap" | "studio" | "membership">(
    "roadmap",
  );
  const [feed, setFeed] = useState<"community" | "terminal">("community");
  const [status, setStatus] = useState<BroadcastStatus>("upcoming");
  const [provider, setProvider] = useState<Provider>("youtube");
  const [videoId, setVideoId] = useState<string>(
    import.meta.env.VITE_LIVE_YOUTUBE_ID ?? "",
  );
  const [channel, setChannel] = useState<string>(
    import.meta.env.VITE_LIVE_TWITCH_CHANNEL ?? "",
  );
  const [parent, setParent] = useState<string>(
    import.meta.env.VITE_LIVE_TWITCH_PARENT ?? window.location.hostname,
  );
  const [fail, setFail] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [started] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      dispatch({ type: "settle", now: time });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const cooldown = Math.max(0, Math.ceil((studio.cooldownUntil - now) / 1000));
  const leading = [...roadmap].sort(
    (a, b) =>
      b.votes +
      Number(studio.voted.includes(b.id)) -
      (a.votes + Number(studio.voted.includes(a.id))),
  )[0];

  return (
    <CommunityPage
      title="CreatorHive Live"
      className="hive-live"
      action={<span className="live-header-note">The open studio</span>}
    >
      <div className="live-layout">
        <div className="live-preview-note">
          <span>
            <i className="live-small-dot" /> Studio preview · sample data, local
            actions
          </span>
          <a href="#live-preview-tools">Settings</a>
        </div>
        <div className="live-stage-layout">
          <Broadcast
            status={status}
            provider={provider}
            videoId={videoId}
            channel={channel}
            parent={parent}
            elapsed={18 * 60 + Math.floor((now - started) / 1000)}
          />
          <aside
            id="live-companion"
            tabIndex={-1}
            className="live-companion"
            aria-label="Alongside the stream"
          >
            <fieldset className="live-switch" aria-label="Broadcast companion">
              <button
                type="button"
                aria-pressed={feed === "community"}
                onClick={() => setFeed("community")}
              >
                The Hive
              </button>
              <button
                type="button"
                aria-pressed={feed === "terminal"}
                onClick={() => setFeed("terminal")}
              >
                <Terminal size={15} aria-hidden="true" /> Build log
              </button>
            </fieldset>
            {feed === "community" ? (
              <div className="live-community">
                <div className="live-feed-heading">
                  <span>Along for the build</span>
                  <span>Sample activity</span>
                </div>
                <ol>
                  {conversation.map((message) => (
                    <li key={message.name}>
                      <span
                        className={`live-avatar ${message.host ? "live-avatar-host" : ""}`}
                      >
                        {message.initials}
                      </span>
                      <div>
                        <div className="live-message-by">
                          <b>{message.name}</b>
                          {message.host ? (
                            <span className="live-host-label">Host</span>
                          ) : null}
                          <time>{message.time}</time>
                        </div>
                        <p>{message.text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="live-community-footer">
                  <p>The conversation keeps going in Chat.</p>
                  <Link to="/chat">
                    Open community chat{" "}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="live-terminal">
                <div className="live-feed-heading">
                  <span>Read-only terminal</span>
                  <span>Sanitized sample</span>
                </div>
                <p className="live-terminal-path">
                  creatorhive / replay-bookmarks
                </p>
                <div
                  className="live-terminal-output"
                  role="log"
                  aria-label="Sanitized terminal output"
                >
                  {terminalLines.map(([time, kind, line]) => (
                    <p key={time}>
                      <time>{time}</time>
                      <span
                        className={
                          kind === "pass"
                            ? "live-terminal-pass"
                            : "live-terminal-kind"
                        }
                      >
                        {kind}
                      </span>
                      <span>{line}</span>
                    </p>
                  ))}
                </div>
                <p className="live-terminal-end">
                  End of sample output<span aria-hidden="true"> ▍</span>
                </p>
                <p className="live-terminal-note">
                  A window into the build. Output only; private values are
                  removed before broadcast.
                </p>
              </div>
            )}
            <div className="live-next">
              <span className="live-eyebrow">Up next · sample schedule</span>
              <strong>The member release review</strong>
              <span>Sat, Sep 12 · 11 AM Eastern</span>
            </div>
          </aside>
        </div>

        <section
          className="live-build-thread"
          aria-label="The Hive build thread"
        >
          <button
            type="button"
            onClick={() => {
              setFeed("terminal");
              reveal("live-companion");
            }}
          >
            <span className="live-thread-number">01</span>
            <span>
              <small>On the workbench</small>
              <strong>Replay bookmarks</strong>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPanel("roadmap");
              reveal("live-participate");
            }}
          >
            <span className="live-thread-number">02</span>
            <span>
              <small>Shaped by your votes</small>
              <strong>{leading.title}</strong>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPanel("studio");
              reveal("live-participate");
            }}
          >
            <span className="live-thread-number">03</span>
            <span>
              <small>
                {studio.queue
                  ? "In the studio queue"
                  : "A little studio energy"}
              </small>
              <strong>
                {studio.queue?.name ??
                  (studio.paused ? "Paused by staff" : "Send something good")}
              </strong>
            </span>
          </button>
        </section>

        <div className="live-participate" id="live-participate" tabIndex={-1}>
          <section
            className="live-participate-main"
            aria-label="Participate in the build"
          >
            <fieldset
              className="live-section-nav"
              aria-label="Ways to participate"
            >
              {(
                [
                  ["roadmap", "Shape the build"],
                  ["studio", "Studio controls"],
                  ["membership", "Membership"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={panel === id}
                  onClick={() => setPanel(id)}
                >
                  {label}
                </button>
              ))}
            </fieldset>
            {panel === "roadmap" ? (
              <div className="live-panel">
                <div className="live-panel-heading">
                  <div>
                    <h2>What should we build next?</h2>
                    <p>Spend a vote on the idea you want to see become real.</p>
                  </div>
                  <span>{studio.votes} vote credits left</span>
                </div>
                <ol className="live-roadmap">
                  {roadmap.map((idea) => {
                    const voted = studio.voted.includes(idea.id);
                    return (
                      <li key={idea.id}>
                        <button
                          type="button"
                          className="live-vote"
                          aria-label={`${voted ? "Voted for" : "Vote for"} ${idea.title}`}
                          aria-pressed={voted}
                          disabled={voted}
                          onClick={() =>
                            dispatch({ type: "vote", id: idea.id })
                          }
                        >
                          {voted ? (
                            <Check size={17} aria-hidden="true" />
                          ) : (
                            <ChevronUp size={17} aria-hidden="true" />
                          )}
                          <span>{idea.votes + Number(voted)}</span>
                        </button>
                        <div>
                          <h3>{idea.title}</h3>
                          <p>{idea.description}</p>
                        </div>
                        <span className="live-roadmap-stage">{idea.stage}</span>
                      </li>
                    );
                  })}
                </ol>
                <p className="live-footnote">
                  One credit per idea. Preview votes reset when you leave this
                  page.
                </p>
              </div>
            ) : panel === "studio" ? (
              <div className="live-panel">
                <div className="live-panel-heading">
                  <div>
                    <h2>A little energy for the studio.</h2>
                    <p>
                      Small, approved moments. Each uses points + 1 interaction
                      credit.
                    </p>
                  </div>
                  <span>
                    {studio.paused
                      ? "Paused by staff"
                      : cooldown
                        ? `Cooling down · ${cooldown}s`
                        : "Ready"}
                  </span>
                </div>
                <div className="live-actions">
                  {actions.map((action) => {
                    const Icon = icons[action.icon];
                    return (
                      <button
                        key={action.id}
                        type="button"
                        className="live-action"
                        disabled={
                          studio.paused || Boolean(studio.queue) || cooldown > 0
                        }
                        onClick={() =>
                          dispatch({
                            type: "queue",
                            id: action.id,
                            now: Date.now(),
                            fail,
                          })
                        }
                      >
                        <Icon size={21} aria-hidden="true" />
                        <span>
                          <strong>{action.name}</strong>
                          <small>{action.detail}</small>
                        </span>
                        <span className="live-action-cost">
                          {action.cost}
                          <small>points</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="live-footnote">
                  One action at a time · 20-second cooldown · Failed or
                  cancelled actions are refunded.
                </p>
                <details className="live-details">
                  <summary>How the studio stays comfortable</summary>
                  <p>
                    Staff can pause the queue at any time. Camera angles and
                    robot movements use approved presets. Sounds have a fixed
                    duration and volume cap. The preview sends nothing to the
                    studio.
                  </p>
                </details>
              </div>
            ) : (
              <div className="live-panel live-membership">
                <p className="live-eyebrow">A seat in the Hive</p>
                <h2>Watch. Build. Have a say.</h2>
                <p>
                  CreatorHive membership brings you inside the process, from the
                  first sketch to the software you use.
                </p>
                <p className="live-price">
                  $99<span> / month</span>
                </p>
                <ul>
                  {[
                    "Access to CreatorHive software",
                    "Livestreams and a voice in what ships",
                    "Feature and roadmap voting",
                    "Early releases to try and shape",
                    "Monthly studio credits for approved interactions",
                  ].map((benefit) => (
                    <li key={benefit}>
                      <Check size={16} aria-hidden="true" />
                      {benefit}
                    </li>
                  ))}
                </ul>
                <p className="live-footnote">
                  Membership preview. Paid enrollment and renewal details are
                  not connected yet.
                </p>
              </div>
            )}
            <p className="live-feedback" role="status">
              {studio.message ||
                "Try a vote or a studio action. Only sample balances will change."}
            </p>
          </section>
          <aside className="live-member" aria-label="Your studio membership">
            <p className="live-eyebrow">Your place in the Hive</p>
            <h2>{preview ? "Preview visitor" : "Community member"}</h2>
            <p>Studio membership · sample account</p>
            <dl>
              <div>
                <dt>Points</dt>
                <dd>{studio.points}</dd>
              </div>
              <div>
                <dt>Vote credits</dt>
                <dd>{studio.votes}</dd>
              </div>
              <div>
                <dt>Interaction credits</dt>
                <dd>{studio.credits}</dd>
              </div>
            </dl>
            <div className="live-member-message">
              <span className="live-small-dot" />
              <p>
                {studio.queue
                  ? `${studio.queue.name} is queued. Waiting for the studio…`
                  : studio.last}
              </p>
            </div>
            <button
              type="button"
              className="live-text-button"
              onClick={() => setPanel("membership")}
            >
              Explore membership <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          </aside>
        </div>

        <details className="live-preview-tools" id="live-preview-tools">
          <summary>
            Preview settings <span>Try broadcast and studio states</span>
          </summary>
          <p>
            Local rehearsal only. These settings do not change the broadcast,
            your real account, or studio hardware.
          </p>
          <div className="live-preview-fields">
            <label>
              Broadcast state
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as BroadcastStatus)}
              >
                <option value="upcoming">Upcoming</option>
                <option value="live">Live</option>
                <option value="offline">Offline</option>
              </select>
            </label>
            <label>
              Player
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as Provider)}
              >
                <option value="youtube">YouTube</option>
                <option value="twitch">Twitch</option>
              </select>
            </label>
            {provider === "youtube" ? (
              <label>
                YouTube video ID
                <input
                  value={videoId}
                  onChange={(e) => setVideoId(e.target.value.trim())}
                  placeholder="11-character video ID"
                />
              </label>
            ) : (
              <>
                <label>
                  Twitch channel
                  <input
                    value={channel}
                    onChange={(e) => setChannel(e.target.value.trim())}
                    placeholder="Channel name"
                  />
                </label>
                <label>
                  Twitch parent hostname
                  <input
                    value={parent}
                    onChange={(e) => setParent(e.target.value.trim())}
                    placeholder="app.creatorhive.ai"
                  />
                </label>
              </>
            )}
          </div>
          <div className="live-preview-buttons">
            <button type="button" onClick={() => dispatch({ type: "empty" })}>
              Try empty balances
            </button>
            <button type="button" onClick={() => dispatch({ type: "reset" })}>
              Reset sample account
            </button>
            <label>
              <input
                type="checkbox"
                checked={fail}
                onChange={(e) => setFail(e.target.checked)}
              />{" "}
              Simulate action failure
            </label>
          </div>
          <details className="live-details">
            <summary>Simulate staff controls</summary>
            <p>
              This is a demonstration of the staff kill switch, not a staff
              permission grant.
            </p>
            <button
              className="live-stop"
              type="button"
              onClick={() => dispatch({ type: "pause" })}
            >
              {studio.paused
                ? "Resume preview studio"
                : "Pause all preview actions"}
            </button>
          </details>
        </details>
        <footer className="live-footer">
          <span>CREATORHIVE</span>
          <span>Made together. In the open.</span>
          <Link to="/pulse">Back to the community ↗</Link>
        </footer>
      </div>
    </CommunityPage>
  );
}
