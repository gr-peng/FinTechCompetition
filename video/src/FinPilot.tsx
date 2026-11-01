import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Chapter, Scope} from './chapter';
import {Fade} from './parts';
import {Arch, End, Hook, Intro} from './scenes';
import {CHAPTERS, RISK_BEATS} from './script';
import {C, FONT} from './theme';
import {FPS, SEGMENTS, TOTAL_FRAMES, seg} from './timeline';

const DARK = new Set(['hook', ...RISK_BEATS]);

const Background: React.FC = () => {
  const f = useCurrentFrame();
  const stops: number[] = [], values: number[] = [];
  for (const s of SEGMENTS) {
    const v = DARK.has(s.id) ? 1 : 0;
    stops.push(s.from + 5, s.from + s.frames - 1);
    values.push(v, v);
  }
  const dark = interpolate(f, stops, values, {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const a = 30 + Math.sin(f / 90) * 12, b = 70 + Math.cos(f / 110) * 12;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{background: `radial-gradient(900px 700px at ${a}% 20%, #DCE6FF, transparent), radial-gradient(900px 800px at ${b}% 80%, #EBDFFF, transparent), #F3F5FF`}} />
      <AbsoluteFill style={{opacity: dark, background: `radial-gradient(1000px 700px at ${b}% 50%, #1B2A5E, transparent), ${C.night}`}} />
    </AbsoluteFill>
  );
};

const Subtitles: React.FC = () => {
  const f = useCurrentFrame();
  const s = SEGMENTS.find((x) => f >= x.from && f < x.from + x.voiceFrames + 6);
  // The end card already shows the line being spoken.
  if (!s || s.id === 'end') return null;
  const parts = s.text.split(/(?<=[，。？：])/).map((p) => p.trim()).filter(Boolean);
  // Join very short clauses so each caption reads as a phrase.
  const lines: string[] = [];
  for (const p of parts) {
    if (lines.length && lines[lines.length - 1].length < 8) lines[lines.length - 1] += p;
    else lines.push(p);
  }
  const total = lines.reduce((n, l) => n + l.length, 0);
  let cursor = 0;
  let text = lines[lines.length - 1];
  const progress = (f - s.from) / s.voiceFrames;
  for (const l of lines) {
    cursor += l.length / total;
    if (progress <= cursor) {
      text = l;
      break;
    }
  }
  return (
    <div style={{position: 'absolute', bottom: 40, left: 0, right: 0, textAlign: 'center'}}>
      <span style={{display: 'inline-block', maxWidth: 1500, padding: '9px 26px', borderRadius: 14, background: 'rgba(11,16,32,.72)', color: '#fff', fontFamily: FONT, fontSize: 34, fontWeight: 500, letterSpacing: 0.5}}>
        {text.replace(/[，。：]$/, '')}
      </span>
    </div>
  );
};

const span = (first: string, last: string) => {
  const a = seg(first), b = seg(last);
  return {from: a.from, frames: b.from + b.frames - a.from};
};

const SCENES: {id: string; from: number; frames: number; node: React.ReactNode}[] = [
  {id: 'hook', ...span('hook', 'hook'), node: <Hook frames={seg('hook').frames} />},
  {id: 'intro', ...span('intro', 'intro'), node: <Intro frames={seg('intro').frames} />},
  ...CHAPTERS.map((chapter) => ({id: chapter.id, ...span(chapter.beats[0].id, chapter.beats[chapter.beats.length - 1].id), node: <Chapter chapter={chapter} />})),
  {id: 'scope', ...span('scope', 'scope'), node: <Scope />},
  {id: 'arch', ...span('arch', 'arch'), node: <Arch frames={seg('arch').frames} />},
  {id: 'end', ...span('end', 'end'), node: <End frames={seg('end').frames} />},
];

export const FinPilot: React.FC = () => {
  const musicVolume = (f: number) => {
    const fadeOut = interpolate(f, [TOTAL_FRAMES - 3 * FPS, TOTAL_FRAMES], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
    const fadeIn = interpolate(f, [0, 1.5 * FPS], [0, 1], {extrapolateRight: 'clamp'});
    return 0.13 * fadeIn * fadeOut;
  };
  return (
    <AbsoluteFill style={{background: C.night}}>
      <Background />
      {SCENES.map((s) => (
        <Sequence key={s.id} from={s.from} durationInFrames={s.frames} name={s.id}>
          <Fade frames={s.frames}>{s.node}</Fade>
        </Sequence>
      ))}
      {SEGMENTS.map((s) => (
        <Sequence key={s.id} from={s.from} durationInFrames={s.frames} layout="none" name={'voice-' + s.id}><Audio src={staticFile(`voice/${s.id}.mp3`)} /></Sequence>
      ))}
      <Audio src={staticFile('audio/music.wav')} volume={musicVolume} />
      {SCENES.filter((s) => s.id !== 'hook').map((s) => (
        <Sequence key={s.id} from={Math.max(0, s.from - 6)} durationInFrames={15} layout="none"><Audio src={staticFile('audio/whoosh.wav')} volume={0.12} /></Sequence>
      ))}
      <Subtitles />
    </AbsoluteFill>
  );
};
