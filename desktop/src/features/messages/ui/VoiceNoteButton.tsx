import * as React from "react";

import { Loader2, Mic, Square } from "lucide-react";

import { getRelayHttpUrl } from "@/shared/api/tauri";

/**
 * Record a voice note and hand it to the composer's upload pipeline.
 *
 * The relay only stores canonical H.264/AAC fast-start MP4s, and MediaRecorder
 * output varies by webview engine (audio/mp4 on WebKit, webm/opus on
 * Chromium-based webviews). Rather than ship a per-platform encoder, the raw
 * recording is POSTed to the relay's `/voice/convert` endpoint, which returns
 * a compliant MP4 (16x16 black video track + AAC). That file then flows
 * through the exact same attachment path as a pasted video, so preview,
 * cancel, and send behavior stay consistent.
 */

const MIME_CANDIDATES = [
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
];

/** Hard stop so a forgotten recording can't grow unbounded (relay caps at 600s). */
const MAX_SECONDS = 300;

type RecorderState = "idle" | "recording" | "converting";

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VoiceNoteButton({
  disabled,
  onFile,
}: {
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const [state, setState] = React.useState<RecorderState>("idle");
  const [seconds, setSeconds] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<BlobPart[]>([]);
  const timerRef = React.useRef<number | null>(null);

  const stopRecording = React.useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
  }, []);

  React.useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        rec.stream.getTracks().forEach((t) => t.stop());
        rec.stop();
      }
    };
  }, []);

  const startRecording = React.useCallback(async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone unavailable — check system permissions.");
      return;
    }

    const mimeType = MIME_CANDIDATES.find(
      (m) =>
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported(m),
    );
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    chunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      recorderRef.current = null;

      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "application/octet-stream",
      });
      chunksRef.current = [];
      if (blob.size === 0) {
        setState("idle");
        setSeconds(0);
        return;
      }

      setState("converting");
      try {
        const base = (await getRelayHttpUrl()).replace(/\/+$/, "");
        const resp = await fetch(`${base}/voice/convert`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: blob,
        });
        if (!resp.ok) {
          throw new Error(`conversion failed (${resp.status})`);
        }
        const bytes = await resp.arrayBuffer();
        const file = new File([bytes], `voice-note-${Date.now()}.mp4`, {
          type: "video/mp4",
        });
        onFile(file);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Voice note failed.");
      } finally {
        setState("idle");
        setSeconds(0);
      }
    };

    recorder.start(1000);
    recorderRef.current = recorder;
    setState("recording");
    setSeconds(0);
    timerRef.current = window.setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) {
          stopRecording();
        }
        return s + 1;
      });
    }, 1000);
  }, [onFile, stopRecording]);

  const recording = state === "recording";
  const converting = state === "converting";

  return (
    <div className="flex items-center gap-1">
      <button
        aria-label={
          recording ? "Stop recording voice note" : "Record voice note"
        }
        className={
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors " +
          (recording
            ? "bg-destructive/15 text-destructive"
            : "text-muted-foreground hover:bg-accent/10 hover:text-foreground")
        }
        disabled={disabled || converting}
        onClick={() => {
          if (recording) {
            stopRecording();
          } else {
            void startRecording();
          }
        }}
        title={recording ? "Stop and attach" : "Record voice note"}
        type="button"
      >
        {converting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : recording ? (
          <Square className="h-4 w-4" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </button>
      {recording ? (
        <span className="text-xs tabular-nums text-destructive">
          {formatSeconds(seconds)}
        </span>
      ) : null}
      {error ? (
        <span className="max-w-40 truncate text-xs text-destructive" title={error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
