/**
 * Voice notes on the web, in the desktop app's exact wire shape.
 *
 * The relay refuses recognized audio uploads (no audio sanitizer yet), so
 * voice notes travel as audio-only MP4 through the video pipeline: filename
 * `voice-note-<ts>.mp4`, mime `video/mp4`, plus `duration` and `filename`
 * imeta fields. That is the convention the desktop composer ships (it
 * records WAV and transcodes natively). A browser has no AAC encoder, so we
 * post our WAV to the keeper's transcode shop (`/keeper/voice/transcode`,
 * NIP-98 gated, same-origin proxy) and upload the returned MP4 to the relay
 * ourselves, signed by the member like any other attachment.
 *
 * The WAV encoder mirrors the desktop's: mono 16-bit at 24 kHz, linear
 * resample, channels mixed down. Small enough to ship, big enough to hear.
 */

import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { uploadBytes, type UploadedMedia } from "@/features/chat/upload";

const OUTPUT_SAMPLE_RATE = 24_000;
const MAX_VOICE_MP4_BYTES = 12 * 1024 * 1024;
export const VOICE_NOTE_MAX_DURATION_SECONDS = 5 * 60;

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function encodeVoiceNoteWav(
  channels: readonly Float32Array[],
  inputSampleRate: number,
  outputSampleRate = OUTPUT_SAMPLE_RATE,
): Uint8Array {
  const inputLength = channels[0]?.length ?? 0;
  if (
    channels.length === 0 ||
    inputLength === 0 ||
    !Number.isFinite(inputSampleRate) ||
    inputSampleRate <= 0
  ) {
    throw new Error("Cannot encode an empty voice note");
  }

  const frameCount = Math.max(
    1,
    Math.floor((inputLength * outputSampleRate) / inputSampleRate),
  );
  const bytes = new Uint8Array(44 + frameCount * 2);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, outputSampleRate, true);
  view.setUint32(28, outputSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, frameCount * 2, true);

  const ratio = inputSampleRate / outputSampleRate;
  for (let outputIndex = 0; outputIndex < frameCount; outputIndex += 1) {
    const sourcePosition = outputIndex * ratio;
    const leftIndex = Math.min(inputLength - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(inputLength - 1, leftIndex + 1);
    const mix = sourcePosition - leftIndex;
    let sample = 0;
    for (const channel of channels) {
      const left = channel[leftIndex] ?? 0;
      const right = channel[rightIndex] ?? left;
      sample += left + (right - left) * mix;
    }
    sample = Math.max(-1, Math.min(1, sample / channels.length));
    view.setInt16(
      44 + outputIndex * 2,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    );
  }

  return bytes;
}

async function sha256HexOf(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** WAV in, relay-hosted voice-note MP4 out, ready for the send path. */
export async function prepareVoiceNote(
  wav: Uint8Array,
  durationSeconds: number,
): Promise<UploadedMedia> {
  const wavBuffer = wav.buffer.slice(
    wav.byteOffset,
    wav.byteOffset + wav.byteLength,
  ) as ArrayBuffer;

  const url = `${window.location.origin}/keeper/voice/transcode`;
  const auth = await makeNip98AuthHeader(url, "POST", {
    payloadSha256: await sha256HexOf(wavBuffer),
  });
  const response = await fetch("/keeper/voice/transcode", {
    method: "POST",
    body: wavBuffer,
    headers: { Authorization: auth, "Content-Type": "audio/wav" },
  });
  if (!response.ok) {
    let message = "could not prepare the voice note";
    try {
      const parsed = (await response.json()) as { error?: string };
      if (parsed.error) {
        message = parsed.error;
      }
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }

  const mp4 = await response.arrayBuffer();
  const media = await uploadBytes(mp4, "video/mp4", MAX_VOICE_MP4_BYTES);
  return {
    ...media,
    duration: Math.max(1, Math.round(durationSeconds)),
    filename: `voice-note-${Date.now()}.mp4`,
  };
}

export function formatVoiceNoteDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  return `${minutes}:${String(rounded % 60).padStart(2, "0")}`;
}
