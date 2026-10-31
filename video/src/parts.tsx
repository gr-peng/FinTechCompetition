import React from 'react';
import {AbsoluteFill, Easing, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, FONT} from './theme';

export const useIn = (delay = 0, damping = 16) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - delay, fps, config: {damping, mass: 0.8}});
};

export const Rise: React.FC<{delay?: number; y?: number; style?: React.CSSProperties; children: React.ReactNode}> = ({delay = 0, y = 26, style, children}) => {
  const p = useIn(delay);
  return <div style={{opacity: p, transform: `translateY(${(1 - p) * y}px)`, ...style}}>{children}</div>;
};

export const Fade: React.FC<{frames: number; children: React.ReactNode}> = ({frames, children}) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 8, frames - 8, frames], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{opacity: o}}>{children}</AbsoluteFill>;
};

const PHONE_H = 884;
const PHONE_W = Math.round((PHONE_H * 414) / 868);

export const Phone: React.FC<{clip: string; rate?: number; startFrom?: number; x: number; glow?: string; delay?: number}> = ({clip, rate = 1, startFrom = 0, x, glow, delay = 0}) => {
  const p = useIn(delay, 18);
  const inner = PHONE_W - 24;
  return (
    <div style={{position: 'absolute', left: x, top: 34, width: PHONE_W, height: PHONE_H, opacity: p,
      transform: `translateY(${(1 - p) * 60}px) scale(${0.96 + p * 0.04})`, padding: 12, borderRadius: 58, background: '#111318', boxSizing: 'border-box',
      boxShadow: glow ? `0 0 0 4px ${glow}, 0 0 90px 16px ${glow}` : '0 40px 80px -30px rgba(40,60,130,.55)'}}>
      <div style={{width: inner, height: PHONE_H - 24, borderRadius: 46, overflow: 'hidden', position: 'relative', background: '#EAF0FF'}}>
        <OffthreadVideo src={staticFile(`clips/${clip}.mp4`)} muted playbackRate={rate} startFrom={startFrom} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
      </div>
      <div style={{position: 'absolute', top: 22, left: '50%', marginLeft: -48, width: 96, height: 28, borderRadius: 16, background: '#000'}} />
    </div>
  );
};
export const PHONE_WIDTH = PHONE_W;

export const Mascot: React.FC<{size: number; style?: React.CSSProperties}> = ({size, style}) => {
  const f = useCurrentFrame();
  return <Img src={staticFile('img/dot.png')} style={{width: size, height: size, transform: `translateY(${Math.sin(f / 16) * 6}px)`, ...style}} />;
};

export const Title: React.FC<{dark?: boolean; size?: number; children: React.ReactNode; style?: React.CSSProperties}> = ({dark, size = 72, children, style}) => (
  <div style={{fontFamily: FONT, fontWeight: 700, fontSize: size, lineHeight: 1.22, letterSpacing: -1, color: dark ? '#fff' : C.ink, ...style}}>{children}</div>
);

export const Sub: React.FC<{dark?: boolean; children: React.ReactNode; style?: React.CSSProperties}> = ({dark, children, style}) => (
  <div style={{fontFamily: FONT, fontWeight: 500, fontSize: 30, lineHeight: 1.5, color: dark ? 'rgba(255,255,255,.72)' : C.muted, ...style}}>{children}</div>
);

export const Check: React.FC<{done: boolean; color?: string}> = ({done, color = C.green}) => {
  const f = useCurrentFrame();
  void f;
  return (
    <div style={{width: 40, height: 40, borderRadius: 20, flex: 'none', display: 'grid', placeItems: 'center', background: done ? color : 'rgba(62,99,221,.1)', transition: 'none'}}>
      {done ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L19 7" /></svg> : null}
    </div>
  );
};

export const Row: React.FC<{title: string; detail?: string; done?: boolean; delay?: number; color?: string; dark?: boolean}> = ({title, detail, done = false, delay = 0, color, dark}) => {
  const p = useIn(delay);
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 18, padding: '18px 24px', borderRadius: 22, opacity: p, transform: `translateX(${(1 - p) * -30}px)`, fontFamily: FONT,
      background: dark ? 'rgba(255,255,255,.08)' : done ? '#fff' : 'rgba(255,255,255,.62)', boxShadow: done && !dark ? '0 18px 40px -26px rgba(62,99,221,.7)' : 'none'}}>
      <Check done={done} color={color} />
      <div>
        <div style={{fontSize: 30, fontWeight: 650, color: dark ? '#fff' : C.ink}}>{title}</div>
        {detail ? <div style={{fontSize: 22, marginTop: 3, color: dark ? 'rgba(255,255,255,.66)' : C.muted}}>{detail}</div> : null}
      </div>
    </div>
  );
};

export const Stamp: React.FC<{text: string; color: string; delay: number}> = ({text, color, delay}) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [delay, delay + 7], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.back(2))});
  return (
    <div style={{display: 'inline-block', padding: '10px 28px', border: `5px solid ${color}`, borderRadius: 18, color, fontFamily: FONT, fontWeight: 800, fontSize: 58, letterSpacing: 2,
      opacity: f < delay ? 0 : 1, transform: `rotate(-5deg) scale(${1.7 - p * 0.7})`, transformOrigin: '100% 50%', whiteSpace: 'nowrap'}}>{text}</div>
  );
};

export const Label: React.FC<{dark?: boolean; children: React.ReactNode}> = ({dark, children}) => (
  <div style={{fontFamily: FONT, fontSize: 24, fontWeight: 650, letterSpacing: 1, color: dark ? '#9DB1FF' : C.accent}}>{children}</div>
);
