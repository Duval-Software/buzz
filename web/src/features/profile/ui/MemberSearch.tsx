import { useState, useEffect } from "react";
import { searchProfileMembers } from "../public-profile";
export function MemberSearch() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<
    { username: string; display_name: string }[]
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setRows([]);
    setError("");
    if (!query.trim()) return;
    const timer = setTimeout(
      () =>
        void searchProfileMembers(query.trim())
          .then((r) => {
            if (active) setRows(r);
          })
          .catch(() => {
            if (active) setError("Member search unavailable.");
          }),
      250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);
  return (
    <div className="px-4 py-2">
      <label className="block text-sm">
        Find a member
        <input
          className="w-full rounded border border-neutral-700 bg-transparent p-2"
          type="search"
          maxLength={64}
          placeholder="Name or @username"
          value={query}
          onChange={(e) => setQuery(e.target.value.replace(/^@/, ""))}
        />
      </label>
      {error && <p role="status">{error}</p>}
      <ul>
        {rows.map((r) => (
          <li key={r.username}>
            <a className="block py-2 text-sm" href={`/@${r.username}`}>
              {r.display_name}{" "}
              <span className="text-neutral-500">@{r.username}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
