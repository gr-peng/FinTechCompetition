import marks from './marks.json';
import voice from './voice.json';

export const FPS = 30;
const GAP = 0.32;
// Extra seconds held on a segment after its narration ends.
const HOLD: Record<string, number> = {hook: 0.5, intro: 0.5, scope: 0.4, arch: 0.8, end: 2.2};

const CLIPS = marks as unknown as Record<string, [string, number][]>;
// Where a narration line starts and ends inside its clip.
export const beatSpan = (clip: string, id: string) => {
  const list = CLIPS[clip];
  const i = list.findIndex(([name]) => name === 'beat:' + id);
  if (i < 0) return null;
  const next = list.slice(i + 1).find(([name]) => name.startsWith('beat:') || name === 'end')!;
  return {start: list[i][1], end: next[1], inside: list.slice(i + 1).filter(([, t]) => t < next[1])};
};
const recorded = (id: string) => {
  for (const clip of Object.keys(CLIPS)) {
    const span = beatSpan(clip, id);
    if (span) return span.end - span.start;
  }
  return 0;
};

export type Segment = {id: string; text: string; from: number; frames: number; voiceFrames: number};

let cursor = Math.round(0.4 * FPS);
export const SEGMENTS: Segment[] = voice.map((line) => {
  const voiceFrames = Math.ceil(line.dur * FPS);
  // A beat with more on-screen actions than narration runs long instead of being sped up.
  const frames = Math.max(voiceFrames + Math.round(((HOLD[line.id] ?? 0.3) + GAP) * FPS), Math.ceil(recorded(line.id) * FPS));
  const segment = {id: line.id, text: line.text, from: cursor, frames, voiceFrames};
  cursor += frames;
  return segment;
});
export const TOTAL_FRAMES = cursor;
export const seg = (id: string) => SEGMENTS.find((s) => s.id === id)!;
