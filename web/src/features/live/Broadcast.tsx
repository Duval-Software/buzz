import { ArrowUpRight, Radio, Users } from "lucide-react";
import { embedUrl, type BroadcastStatus, type Provider } from "./sample-studio";

export function Broadcast({
  status,
  provider,
  videoId,
  channel,
  parent,
  elapsed,
}: {
  status: BroadcastStatus;
  provider: Provider;
  videoId: string;
  channel: string;
  parent: string;
  elapsed: number;
}) {
  const source = embedUrl(
    provider,
    provider === "youtube" ? videoId : channel,
    parent,
  );
  const watchUrl = source
    ? provider === "youtube"
      ? `https://www.youtube.com/watch?v=${videoId}`
      : `https://www.twitch.tv/${channel}`
    : null;
  return (
    <section aria-label="CreatorHive broadcast" className="live-broadcast">
      <div className="live-player">
        {status === "live" && source ? (
          <iframe
            key={source}
            src={source}
            title={`${provider === "youtube" ? "YouTube" : "Twitch"} livestream`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <div className="live-poster">
            <div className="live-poster-top">
              <span>
                <Radio size={15} aria-hidden="true" /> CREATORHIVE / OPEN STUDIO
              </span>
              <span>STUDIO 01</span>
            </div>
            <div className="live-poster-body">
              <p className="live-eyebrow">
                {status === "upcoming"
                  ? "Next in the studio"
                  : status === "offline"
                    ? "Between builds"
                    : "Ready when you are"}
              </p>
              <h2>
                {status === "upcoming" ? (
                  <>
                    The next build
                    <br />
                    starts with you.
                  </>
                ) : status === "offline" ? (
                  <>
                    The stream ends.
                    <br />
                    The ideas don’t.
                  </>
                ) : (
                  <>
                    A front row seat.
                    <br />
                    To the whole build.
                  </>
                )}
              </h2>
              <p>
                {status === "upcoming"
                  ? "Thursday, September 10 · 2 PM Eastern"
                  : status === "offline"
                    ? "Explore the roadmap while we prepare the next session."
                    : "The broadcast will appear here when a stream is connected."}
              </p>
            </div>
            <svg
              className="live-hive-drawing"
              viewBox="0 0 340 380"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M170 22 294 94v144l-124 72L46 238V94Z"
                stroke="currentColor"
              />
              <path
                d="m170 66 86 50v100l-86 50-86-50V116Z"
                stroke="currentColor"
              />
              <path
                d="m170 110 48 28v56l-48 28-48-28v-56Z"
                fill="currentColor"
              />
              <path
                d="M170 22v88m124 128-76-44M46 238l76-44M170 266v66m-68-39 68 39 68-39"
                stroke="currentColor"
              />
              <circle cx="170" cy="22" r="5" fill="currentColor" />
              <circle cx="294" cy="238" r="5" fill="currentColor" />
              <circle cx="46" cy="238" r="5" fill="currentColor" />
            </svg>
            <div className="live-poster-bottom">
              <span>BUILD IN THE OPEN.</span>
              <span>SHAPED BY THE HIVE. ↗</span>
            </div>
          </div>
        )}
      </div>
      <div className="live-broadcast-meta">
        <span className={status === "live" ? "live-on-air" : "live-muted"}>
          <span aria-hidden="true">●</span>{" "}
          {status === "live"
            ? "Live · sample session"
            : status === "upcoming"
              ? "Upcoming · sample schedule"
              : "Studio offline"}
        </span>
        {status === "live" ? (
          <span>
            <Users size={14} aria-hidden="true" /> 248 watching ·{" "}
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
          </span>
        ) : (
          <span>Hosted by Sean & Cole</span>
        )}
        {status === "live" && watchUrl ? (
          <a href={watchUrl} target="_blank" rel="noreferrer">
            Watch on {provider === "youtube" ? "YouTube" : "Twitch"}
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        ) : null}
      </div>
      <div className="live-stream-info">
        <p className="live-eyebrow">CreatorHive Live / Build 014</p>
        <h2>From first idea to first release.</h2>
        <p>
          Building a better way to revisit the moments that matter. Bring your
          questions, follow the code, and help decide what comes next.
        </p>
        <div className="live-hosts">
          <span className="live-host-mark">S</span>
          <span className="live-host-mark">C</span>
          <span>
            Sean & Cole{" "}
            <span className="live-muted">· Building with the Hive</span>
          </span>
        </div>
      </div>
    </section>
  );
}
