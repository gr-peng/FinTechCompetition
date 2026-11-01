import React from 'react';
import {AbsoluteFill, Audio, Easing, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {FPS} from './timeline';
import {C, FONT} from './theme';
import {Mascot, Rise, Sub, Title, useIn} from './parts';

export const Hook: React.FC<{frames: number}> = () => {
  const f = useCurrentFrame();
  const stop = 4.3 * FPS;
  const barrier = interpolate(f, [stop - 8, stop + 6], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const wall = 1320;
  const dots = Array.from({length: 26}, (_, i) => {
    const raw = -120 + i * -118 + f * 15;
    const travelled = -120 + i * -118 + stop * 15;
    // Coins passing the wall before it rises fly on; the rest pile up behind it.
    const passed = travelled > wall;
    const queue = wall - 34 - (i - dots0(stop)) * 62;
    const x = passed ? raw : Math.min(raw, f < stop ? raw : queue);
    return {x, passed, i};
  });
  const line = (from: number, to: number) => interpolate(f, [from, from + 10, to - 8, to], [0, 1, 1, 0.26], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      <div style={{position: 'absolute', top: 210, width: '100%', textAlign: 'center'}}>
        <Title dark size={82} style={{opacity: line(4, 2.3 * FPS)}}>如果 AI 能替你动钱</Title>
        <Title dark size={48} style={{opacity: line(2.3 * FPS, 4.4 * FPS), fontWeight: 500, color: 'rgba(255,255,255,.76)', marginTop: 22}}>最重要的不是它有多聪明</Title>
      </div>
      <div style={{position: 'absolute', top: 540, left: 0, right: 0, height: 2, background: 'rgba(157,177,255,.18)'}} />
      {dots.map((d) => (
        <div key={d.i} style={{position: 'absolute', top: 514, left: d.x, width: 52, height: 52, borderRadius: 26, display: 'grid', placeItems: 'center',
          background: 'linear-gradient(135deg,#7C9BFF,#3E63DD)', color: '#fff', fontFamily: FONT, fontWeight: 700, fontSize: 28, boxShadow: '0 0 24px rgba(92,126,255,.6)'}}>¥</div>
      ))}
      <div style={{position: 'absolute', left: wall, top: 540 - 150 * barrier, width: 10, height: 300 * barrier, borderRadius: 5, background: C.red, boxShadow: `0 0 50px 12px ${C.red}`}} />
      <div style={{position: 'absolute', top: 730, width: '100%', textAlign: 'center', opacity: interpolate(f, [stop, stop + 12], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
        <Title dark size={82}>而是它知道<span style={{color: '#FF6B70'}}>什么时候该停下来</span></Title>
      </div>
      <Sequence from={Math.round(stop)} durationInFrames={28} layout="none"><Audio src={staticFile('audio/alert.wav')} volume={0.5} /></Sequence>
    </AbsoluteFill>
  );
};
function dots0(stop: number) {
  // Index of the first coin still left of the wall when it rises.
  return Math.ceil((-120 + stop * 15 - 1320) / 118);
}

// Optical alignment, measured on rendered frames: centring the boxes leaves the ink off-centre.
// The mascot's mass sits right of its image box, and the full stop leaves the tagline's right side empty.
const MASCOT_X = -6;
const WORDMARK_X = -3;
const TAGLINE_X = 21;

export const Intro: React.FC<{frames: number}> = () => {
  const s = useIn(2, 11);
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', gap: 16}}>
      <div style={{transform: `translateX(${MASCOT_X}px) scale(${s})`}}><Mascot size={260} /></div>
      <Rise delay={7}><Title size={112} style={{transform: `translateX(${WORDMARK_X}px)`}}>FinPilot</Title></Rise>
      <Rise delay={13}><Sub style={{fontSize: 38}}>你的个人财务伙伴</Sub></Rise>
    </AbsoluteFill>
  );
};

const ICONS: Record<string, React.ReactNode> = {
  model: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="4.5" /></>,
  shield: <><path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V6l7-3z" /><path d="M9 12l2 2 4-4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.2-4 4.2-6 8-6s6.8 2 8 6" /></>,
  run: <><path d="M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 9h6M9 13h6" /></>,
};

const Node: React.FC<{x: number; y: number; title: string; detail: string; color: string; on: number; icon: string}> = ({x, y, title, detail, color, on, icon}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = spring({frame: f - on, fps, config: {damping: 15}});
  return (
    <div style={{position: 'absolute', left: x, top: y, width: 290, height: 200, marginLeft: -145, borderRadius: 30, background: '#fff', opacity: p, transform: `scale(${0.85 + p * 0.15})`,
      boxShadow: `0 30px 60px -34px ${color}`, border: `3px solid ${color}`, fontFamily: FONT, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, boxSizing: 'border-box'}}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{ICONS[icon]}</svg>
      <div style={{fontSize: 34, fontWeight: 700, color: C.ink}}>{title}</div>
      <div style={{fontSize: 22, color: C.muted}}>{detail}</div>
    </div>
  );
};

const Note: React.FC<{color: string; bg: string; children: React.ReactNode}> = ({color, bg, children}) => (
  <div style={{padding: '14px 22px', borderRadius: 18, background: bg, color, fontFamily: FONT, fontSize: 28, fontWeight: 650, whiteSpace: 'nowrap'}}>{children}</div>
);

export const Arch: React.FC<{frames: number}> = () => {
  const f = useCurrentFrame();
  const xs = [280, 760, 1160, 1560];
  const y = 300;
  const t = [8, 3.4 * FPS, 5.7 * FPS, 7.3 * FPS];
  const seg = (i: number) => interpolate(f, [t[i + 1] - 16, t[i + 1]], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const show = (at: number) => interpolate(f, [at, at + 12], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill>
      <div style={{position: 'absolute', top: 70, width: '100%', textAlign: 'center'}}>
        <Rise><Title size={68}>模型只能提议，<span style={{color: C.accent}}>不能动钱</span></Title></Rise>
      </div>
      <div style={{position: 'absolute', left: 560, top: 236, width: 1260, height: 460, borderRadius: 40, border: '3px dashed rgba(62,99,221,.38)', background: 'rgba(255,255,255,.34)', opacity: show(3.0 * FPS)}}>
        <div style={{position: 'absolute', left: 30, top: 16, fontFamily: FONT, fontSize: 24, fontWeight: 650, color: C.accent}}>在本地完成</div>
      </div>
      {[0, 1, 2].map((i) => {
        const x1 = xs[i] + 145, x2 = xs[i + 1] - 145, p = seg(i);
        return (
          <React.Fragment key={i}>
            <div style={{position: 'absolute', left: x1, top: y + 97, width: x2 - x1, height: 6, borderRadius: 3, background: 'rgba(62,99,221,.16)'}} />
            <div style={{position: 'absolute', left: x1, top: y + 97, width: (x2 - x1) * p, height: 6, borderRadius: 3, background: C.accent}} />
          </React.Fragment>
        );
      })}
      <Node x={xs[0]} y={y} title="模型" detail="理解意图、整理方案" color={C.soft} on={t[0]} icon="model" />
      <Node x={xs[1]} y={y} title="本地风控" detail="金额、对象、来源" color={C.amber} on={t[1]} icon="shield" />
      <Node x={xs[2]} y={y} title="你确认" detail="改了参数就要重来" color={C.accent} on={t[2]} icon="user" />
      <Node x={xs[3]} y={y} title="程序执行" detail="不重复扣款，记入账本" color={C.green} on={t[3]} icon="run" />
      <div style={{position: 'absolute', left: 110, top: 540, display: 'grid', gap: 12, opacity: show(1.9 * FPS)}}>
        <Note color={C.red} bg="rgba(229,72,77,.1)">✕ 没有动钱的工具</Note>
        <Note color={C.red} bg="rgba(229,72,77,.1)">✕ 拿不到账本和持仓</Note>
      </div>
      <div style={{position: 'absolute', left: 610, top: 568, opacity: show(3.6 * FPS)}}>
        <Note color={C.accent} bg="rgba(62,99,221,.1)">账本只在本地：金额、流水和图表来自同一份数据</Note>
      </div>
    </AbsoluteFill>
  );
};

export const End: React.FC<{frames: number}> = () => {
  const s = useIn(0, 11);
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 50}}>
      <div style={{transform: `translateX(${MASCOT_X}px) scale(${s})`, marginBottom: -16}}><Mascot size={240} /></div>
      <Rise delay={6}><Title size={100} style={{transform: `translateX(${WORDMARK_X}px)`}}>FinPilot</Title></Rise>
      <Rise delay={14}><Title size={60} style={{fontWeight: 600, color: C.accent, transform: `translateX(${TAGLINE_X}px)`}}>钱的事，我陪你。</Title></Rise>
    </AbsoluteFill>
  );
};
