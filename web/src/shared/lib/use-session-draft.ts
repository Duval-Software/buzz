import { useCallback, useState } from "react";
import { relayWsUrl } from "./relay-url";

function read(key: string) {
  try {
    return key ? (sessionStorage.getItem(key) ?? "") : "";
  } catch {
    return "";
  }
}

/** Keep unsent text across account retries, scoped to this tab, identity and destination. */
export function useSessionDraft(
  owner: string | undefined,
  destination: string,
) {
  const key = owner
    ? `creatorhive.draft:${relayWsUrl()}:${owner}:${destination}`
    : "";
  const [state, setState] = useState(() => ({ key, text: read(key) }));
  if (state.key !== key) setState({ key, text: read(key) });
  const setDraft = useCallback(
    (text: string) => {
      try {
        if (key) {
          if (text) sessionStorage.setItem(key, text);
          else sessionStorage.removeItem(key);
        }
      } catch {
        /* Storage restrictions must not prevent composing. */
      }
      // A send completing after navigation clears only its original destination,
      // including when React has already unmounted the original composer.
      setState((previous) => (previous.key === key ? { key, text } : previous));
    },
    [key],
  );
  return [state.key === key ? state.text : read(key), setDraft] as const;
}
