/** Content-shaped placeholders while conversations and feed updates arrive. */
export function ContentSkeleton({ feed = false }: { feed?: boolean }) {
  return (
    <div
      className={`hive-content-skeleton${feed ? " is-feed" : ""}`}
      role="status"
      aria-label={feed ? "Loading updates" : "Loading conversation"}
      aria-busy="true"
    >
      {["80%", "60%", "90%"].map((width) => (
        <div className="hive-skeleton-message" key={width} aria-hidden="true">
          <div className="hive-skeleton-author">
            <span className="hive-skeleton hive-skeleton-avatar" />
            <span className="hive-skeleton hive-skeleton-name" />
            <span className="hive-skeleton hive-skeleton-time" />
          </div>
          <div className="hive-skeleton-copy">
            <span className="hive-skeleton" style={{ width }} />
            <span className="hive-skeleton" style={{ width: "95%" }} />
            <span className="hive-skeleton" style={{ width: "45%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
