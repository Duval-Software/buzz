/**
 * Microphone capture for voice notes, adapted from the desktop composer's
 * recorder (block/buzz#6978) so both clients behave identically.
 *
 * MediaRecorder captures in whatever codec the browser offers; on stop the
 * take is decoded back to PCM and re-encoded as the canonical mono 24 kHz
 * WAV, which the transcode step turns into the relay's voice-note MP4. The
 * analyser feeds a live level meter so the person can see the mic is alive.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeVoiceNoteWav } from "@/features/chat/voice-note";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
] as const;

function supportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export type VoiceNoteTake = {
  duration: number;
  wav: Uint8Array;
};

type RecordingSession = {
  cancelled: boolean;
  chunks: Blob[];
  context: AudioContext | null;
  recorder: MediaRecorder | null;
  resolveStop: ((take: VoiceNoteTake | null) => void) | null;
  startedAt: number;
  stream: MediaStream | null;
};

function releaseSessionAudio(session: RecordingSession) {
  for (const track of session.stream?.getTracks() ?? []) {
    track.stop();
  }
  session.stream = null;
  const context = session.context;
  session.context = null;
  if (context) {
    void context.close().catch(() => undefined);
  }
}

export function useVoiceRecorder() {
  const mountedRef = useRef(true);
  const sessionRef = useRef<RecordingSession | null>(null);
  const [status, setStatus] = useState<"idle" | "recording" | "processing">(
    "idle",
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    session.cancelled = true;
    sessionRef.current = null;
    session.resolveStop?.(null);
    session.resolveStop = null;
    const recorder = session.recorder;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    releaseSessionAudio(session);
    if (mountedRef.current) {
      setStatus("idle");
      setElapsedSeconds(0);
      setLevel(0);
    }
  }, []);

  const start = useCallback(async () => {
    if (status !== "idle" || sessionRef.current) {
      return;
    }
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("Voice recording is not available in this browser.");
      return;
    }

    const session: RecordingSession = {
      cancelled: false,
      chunks: [],
      context: null,
      recorder: null,
      resolveStop: null,
      startedAt: 0,
      stream: null,
    };
    sessionRef.current = session;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      session.stream = stream;
      if (
        session.cancelled ||
        !mountedRef.current ||
        sessionRef.current !== session
      ) {
        releaseSessionAudio(session);
        return;
      }

      const mimeType = supportedMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      session.recorder = recorder;
      const context = new AudioContext();
      session.context = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      context.createMediaStreamSource(stream).connect(analyser);
      session.startedAt = performance.now();
      setElapsedSeconds(0);

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          session.chunks.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => {
        void (async () => {
          const actualMime = recorder.mimeType || mimeType || "audio/webm";
          const blob = new Blob(session.chunks, { type: actualMime });
          session.chunks = [];
          let take: VoiceNoteTake | null = null;
          if (!session.cancelled && blob.size > 0) {
            try {
              const encoded = await blob.arrayBuffer();
              const decoded = await context.decodeAudioData(encoded.slice(0));
              if (!session.cancelled && sessionRef.current === session) {
                const channels = Array.from(
                  { length: decoded.numberOfChannels },
                  (_, index) => decoded.getChannelData(index),
                );
                take = {
                  duration: decoded.duration,
                  wav: encodeVoiceNoteWav(channels, decoded.sampleRate),
                };
              }
            } catch {
              if (
                !session.cancelled &&
                mountedRef.current &&
                sessionRef.current === session
              ) {
                setError("Could not prepare this voice note.");
              }
            }
          }
          releaseSessionAudio(session);
          if (sessionRef.current === session) {
            sessionRef.current = null;
            if (mountedRef.current) {
              setStatus("idle");
              setElapsedSeconds(0);
              setLevel(0);
            }
          }
          session.resolveStop?.(take);
          session.resolveStop = null;
        })();
      });
      recorder.addEventListener("error", () => {
        if (mountedRef.current && sessionRef.current === session) {
          setError("The voice recording was interrupted.");
        }
      });
      recorder.start(250);
      setStatus("recording");

      const samples = new Uint8Array(analyser.fftSize);
      const levelTimer = window.setInterval(() => {
        if (
          recorder.state !== "recording" ||
          session.cancelled ||
          sessionRef.current !== session
        ) {
          window.clearInterval(levelTimer);
          return;
        }
        analyser.getByteTimeDomainData(samples);
        let sumSquares = 0;
        for (const sample of samples) {
          const centered = (sample - 128) / 128;
          sumSquares += centered * centered;
        }
        const rms = Math.sqrt(sumSquares / samples.length);
        if (!mountedRef.current) {
          return;
        }
        setLevel(Math.min(1, rms * 5.5));
        setElapsedSeconds((performance.now() - session.startedAt) / 1000);
      }, 90);
    } catch (cause) {
      releaseSessionAudio(session);
      if (
        session.cancelled ||
        !mountedRef.current ||
        sessionRef.current !== session
      ) {
        return;
      }
      sessionRef.current = null;
      const denied =
        cause instanceof DOMException &&
        (cause.name === "NotAllowedError" || cause.name === "SecurityError");
      setError(
        denied
          ? "Allow microphone access to record a voice note."
          : "Could not start the voice recorder.",
      );
    }
  }, [status]);

  const stop = useCallback((): Promise<VoiceNoteTake | null> => {
    const session = sessionRef.current;
    const recorder = session?.recorder;
    if (!session || !recorder || recorder.state === "inactive") {
      return Promise.resolve(null);
    }
    setStatus("processing");
    return new Promise((resolve) => {
      session.resolveStop = resolve;
      recorder.stop();
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancel();
    };
  }, [cancel]);

  return { cancel, elapsedSeconds, error, level, start, status, stop };
}
