import "./hive-loading.css";

/** Shared entry and route loading screen; resolves as soon as the app is ready. */
export function HiveLoading({
  message = "Loading CreatorHive…",
}: {
  message?: string;
}) {
  return (
    <div className="hive-app hive-loading" role="status" aria-live="polite">
      <div className="hive-loading-content">
        <div className="hive-loading-emblem" aria-hidden="true">
          <svg
            aria-hidden="true"
            className="hive-loading-orbit"
            viewBox="0 0 200 220"
            fill="none"
          >
            <path
              className="hive-loading-track"
              d="M100 8 188 59v102l-88 51-88-51V59Z"
            />
            <path
              className="hive-loading-trace"
              d="M100 8 188 59v102l-88 51-88-51V59Z"
              pathLength="100"
            />
          </svg>
          <img
            src="/creatorhive-logo.png"
            alt=""
            width={128}
            height={128}
            fetchPriority="high"
          />
        </div>
        <div className="hive-loading-wordmark" aria-hidden="true">
          Creator<span>Hive</span>
        </div>
        <p>{message}</p>
      </div>
    </div>
  );
}
