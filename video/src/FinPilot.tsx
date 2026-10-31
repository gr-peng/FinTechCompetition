import React from 'react';
import {AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Arch, Compound, End, Facts, Hook, Inject, Intro, Recurring, Rent, Reported, Risk, Scam, Scope} from './scenes';
import {Fade} from './parts';
import {FPS, SEGMENTS, TOTAL_FRAMES, seg} from './timeline';
import {C, FONT} from './theme';

const SCENES: Record<string, React.FC<{frames: number}>> = {hook: Hook, intro: Intro, compound: Compound, rent: Rent, facts: Facts, risk: Risk, scam: Scam, reported: Reported, inject: Inject, arch: Arch, recurring: Recurring, scope: Scope, end: End};
const DARK = new Set(['hook', 'risk', 'scam', 'reported', 'inject']);
const FOOTAGE = new Set(['compound', 'rent', 'facts', 'scam', 'reported', 'inject', 'recurring', 'scope']);

const Background: React.FC = () => {
  const f = useCurrentFrame();
  const stops: number[] = [], values: number[] = [];
  for (const s of SEGMENTS) {
    const v = DARK.has(s.id) ? 1 : 0;
    stops.push(s.from + 1, s.from + s.frames - 1);
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
  if (!s) return null;
  const parts = s.text.split(/(?<=[，。？])/).map((p) => p.trim()).filter(Boolean);
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
        {text.replace(/[，。]$/, '')}
      </span>
    </div>
  );
};

const Footnote: React.FC = () => {
  const f = useCurrentFrame();
  const s = SEGMENTS.find((x) => f >= x.from && f < x.from + x.frames);
  if (!s || !FOOTAGE.has(s.id)) return null;
  return <div style={{position: 'absolute', left: 36, bottom: 18, fontFamily: FONT, fontSize: 21, color: DARK.has(s.id) ? 'rgba(255,255,255,.62)' : C.muted}}>App 真实录屏 · 模型输出为预设回放 · 数据均为合成</div>;
};

export const FinPilot: React.FC = () => {
  const musicVolume = (f: number) => {
    const fadeOut = interpolate(f, [TOTAL_FRAMES - 3 * FPS, TOTAL_FRAMES], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
    const fadeIn = interpolate(f, [0, 1.5 * FPS], [0, 1], {extrapolateRight: 'clamp'});
    return 0.13 * fadeIn * fadeOut;
  };
  return (
    <AbsoluteFill style={{background: C.night}}>
      <Background />
      {SEGMENTS.map((s) => {
        const Scene = SCENES[s.id];
        return (
          <Sequence key={s.id} from={s.from} durationInFrames={s.frames} name={s.id}>
            <Fade frames={s.frames}><Scene frames={s.frames} /></Fade>
            <Audio src={staticFile(`voice/${s.id}.mp3`)} />
          </Sequence>
        );
      })}
      <Audio src={staticFile('audio/music.wav')} volume={musicVolume} />
      {['intro', 'risk', 'arch', 'end'].map((id) => (
        <Sequence key={id} from={Math.max(0, seg(id).from - 6)} durationInFrames={15} layout="none"><Audio src={staticFile('audio/whoosh.wav')} volume={0.12} /></Sequence>
      ))}
      <Subtitles />
      <Footnote />
    </AbsoluteFill>
  );
};
