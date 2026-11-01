import React from 'react';
import {AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {Check, Label, PHONE_WIDTH, Phone, Rise, Stamp, Title, useIn} from './parts';
import {Beat, Chapter as ChapterData} from './script';
import {C, FONT} from './theme';
import {FPS, beatSpan, seg} from './timeline';

const PHONE_X = 1920 - 170 - PHONE_WIDTH;

// The part of a clip that plays under one narration line, stretched to fit it.
const beatPlayback = (beat: Pick<Beat, 'id' | 'clip'>) => {
  const {start, end, inside} = beatSpan(beat.clip, beat.id)!;
  const {frames} = seg(beat.id);
  const rate = ((end - start) * FPS) / frames;
  const frameOf = (t: number) => Math.round(((t - start) / rate) * FPS);
  return {
    start, rate, frames,
    taps: inside.filter(([name]) => name.startsWith('tap:')).map(([, t]) => frameOf(t)),
    stamp: inside.filter(([name]) => name === 'stamp').map(([, t]) => frameOf(t)).pop(),
  };
};

export const BeatVideo: React.FC<{beat: Pick<Beat, 'id' | 'clip'>}> = ({beat}) => {
  const {start, rate, frames, taps, stamp} = beatPlayback(beat);
  return (
    <>
      <OffthreadVideo src={staticFile(`clips/${beat.clip}.mp4`)} muted playbackRate={rate} startFrom={Math.round(start * FPS)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
      {taps.map((at) => (
        <Sequence key={at} from={at} durationInFrames={10} layout="none"><Audio src={staticFile('audio/tick.wav')} volume={0.28} /></Sequence>
      ))}
      {stamp !== undefined && stamp < frames ? <Sequence from={stamp} durationInFrames={28} layout="none"><Audio src={staticFile('audio/alert.wav')} volume={0.4} /></Sequence> : null}
    </>
  );
};

const Row: React.FC<{beat: Beat; dark: boolean; done: boolean; tight: boolean}> = ({beat, dark, done, tight}) => {
  const p = useIn(0);
  const color = beat.risk ? C.red : C.green;
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 16, padding: tight ? '8px 22px' : '13px 22px', borderRadius: 20, opacity: p, transform: `translateX(${(1 - p) * -30}px)`, fontFamily: FONT,
      background: dark ? 'rgba(255,255,255,.08)' : '#fff', boxShadow: dark ? 'none' : '0 18px 40px -26px rgba(62,99,221,.7)'}}>
      <Check done={done} color={color} />
      <div>
        <div style={{fontSize: 28, fontWeight: 650, color: dark ? '#fff' : C.ink}}>{beat.title}</div>
        <div style={{fontSize: 21, marginTop: 2, color: dark ? 'rgba(255,255,255,.66)' : C.muted}}>{beat.detail}</div>
      </div>
    </div>
  );
};

export const Chapter: React.FC<{chapter: ChapterData}> = ({chapter}) => {
  const f = useCurrentFrame();
  const origin = seg(chapter.beats[0].id).from;
  const place = chapter.beats.map((beat) => {
    const s = seg(beat.id);
    return {beat, from: s.from - origin, frames: s.frames};
  });
  const now = Math.max(0, place.filter((p) => f >= p.from).length - 1);
  const {beat} = place[now];
  const dark = !!beat.risk;
  const tight = chapter.beats.length > 6;
  const playback = beat.stamp ? beatPlayback(beat) : null;
  const stampAt = playback?.stamp === undefined ? null : place[now].from + playback.stamp;
  const hit = stampAt !== null && f >= stampAt;
  const shake = hit && f < stampAt + 12 ? Math.sin(f * 2.4) * 7 : 0;
  return (
    <AbsoluteFill>
      <div style={{position: 'absolute', left: 130, top: 96, width: 900}}>
        <Rise><Label dark={dark}>{chapter.label}</Label></Rise>
        <Rise delay={3}><Title dark={dark} size={chapter.title.length > 11 ? 54 : 62} style={{marginTop: 10}}>{chapter.title}</Title></Rise>
        <Rise delay={7} style={{marginTop: 18}}>
          <span style={{display: 'inline-block', padding: '8px 18px', borderRadius: 14, fontFamily: FONT, fontSize: 23, fontWeight: 600,
            color: dark ? '#C9D5FF' : C.accent, background: dark ? 'rgba(157,177,255,.14)' : 'rgba(62,99,221,.1)'}}>{chapter.tag}</span>
        </Rise>
        <div style={{display: 'grid', gap: tight ? 8 : 10, marginTop: tight ? 22 : 30}}>
          {place.slice(0, now + 1).map((p, i) => (
            <Sequence key={p.beat.id} from={p.from} layout="none"><Row beat={p.beat} dark={dark} done={i < now || f > p.from + p.frames * 0.72} tight={tight} /></Sequence>
          ))}
        </div>
      </div>
      <div style={{position: 'absolute', inset: 0, transform: `translateX(${shake}px)`}}>
        <Phone x={PHONE_X} glow={dark ? 'rgba(229,72,77,.5)' : undefined}>
          {place.map((p) => (
            <Sequence key={p.beat.id} from={p.from} durationInFrames={p.frames} layout="none"><BeatVideo beat={p.beat} /></Sequence>
          ))}
        </Phone>
      </div>
      {beat.stamp && stampAt !== null ? <div style={{position: 'absolute', right: 170 + PHONE_WIDTH + 40, top: 730}}><Stamp text={beat.stamp} color="#FF6B70" delay={stampAt} /></div> : null}
    </AbsoluteFill>
  );
};

const NAMES = ['智能转账', '账单分析', '理财操作', '卡片管理', '订阅管理', '跨场景联动'];

export const Scope: React.FC = () => {
  const {frames} = seg('scope');
  return (
    <AbsoluteFill>
      <Phone x={170}><Sequence durationInFrames={frames} layout="none"><BeatVideo beat={{id: 'scope', clip: 'broll'}} /></Sequence></Phone>
      <div style={{position: 'absolute', left: 170 + PHONE_WIDTH + 130, top: 210, width: 820}}>
        <Rise><Label>覆盖范围</Label></Rise>
        <Rise delay={4}><Title style={{marginTop: 14}}>六类业务，<br />一个伙伴</Title></Rise>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 44}}>
          {NAMES.map((name, i) => (
            <Rise key={name} delay={10 + i * 7} style={{display: 'flex', alignItems: 'center', gap: 14, padding: '20px 24px', borderRadius: 22, background: '#fff', fontFamily: FONT, fontSize: 32, fontWeight: 650, color: C.ink, boxShadow: '0 18px 40px -26px rgba(62,99,221,.7)'}}>
              <Check done />{name}
            </Rise>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
