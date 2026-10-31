import voice from './voice.json';

export const FPS = 30;
const GAP = 0.32;
// Extra seconds held on a segment after its narration ends.
const HOLD: Record<string, number> = {hook: 0.5, intro: 0.3, compound: 1.2, rent: 0.6, facts: 0.7, risk: 0.2, scam: 0.5, reported: 0.5, inject: 0.5, arch: 0.5, recurring: 0.5, scope: 0.4, end: 2.2};

export type Segment = {id: string; text: string; from: number; frames: number; voiceFrames: number};

let cursor = Math.round(0.4 * FPS);
export const SEGMENTS: Segment[] = voice.map((line) => {
  const voiceFrames = Math.ceil(line.dur * FPS);
  const frames = voiceFrames + Math.round(((HOLD[line.id] ?? 0) + GAP) * FPS);
  const segment = {id: line.id, text: line.text, from: cursor, frames, voiceFrames};
  cursor += frames;
  return segment;
});
export const TOTAL_FRAMES = cursor;
export const seg = (id: string) => SEGMENTS.find((s) => s.id === id)!;
