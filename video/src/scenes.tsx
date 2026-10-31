import React from 'react';
import {AbsoluteFill, Audio, Easing, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import marks from './marks.json';
import {FPS} from './timeline';
import {C, FONT} from './theme';
import {Check, Label, Mascot, PHONE_WIDTH, Phone, Rise, Row, Stamp, Sub, Title, useIn} from './parts';

const mark = (clip: keyof typeof marks, label: string) => (marks[clip] as [string, number][]).find(([name]) => name.startsWith(label))![1];
// Frame in the scene at which a moment of a clip plays, given skipped lead-in and playback rate.
const at = (seconds: number, skip: number, rate: number, delay = 0) => Math.round(((seconds - skip) / rate) * FPS) + delay;
const Tick: React.FC<{at: number; volume?: number}> = ({at: from, volume = 0.5}) => (
  <Sequence from={Math.max(0, from)} durationInFrames={10} layout="none"><Audio src={staticFile('audio/tick.wav')} volume={volume} /></Sequence>
);
const Alert: React.FC<{at: number}> = ({at: from}) => (
  <Sequence from={from} durationInFrames={28} layout="none"><Audio src={staticFile('audio/alert.wav')} volume={0.55} /></Sequence>
);

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

export const Intro: React.FC<{frames: number}> = () => {
  const s = useIn(2, 11);
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', gap: 16}}>
      <div style={{transform: `scale(${s})`}}><Mascot size={260} /></div>
      <Rise delay={7}><Title size={112}>FinPilot</Title></Rise>
      <Rise delay={13}><Sub style={{fontSize: 38}}>你的个人财务伙伴</Sub></Rise>
    </AbsoluteFill>
  );
};

export const Compound: React.FC<{frames: number}> = () => {
  const f = useCurrentFrame();
  const skip = 0.5, rate = 1.55;
  const steps = [['发送短信', '给妈妈：周末我回家吃饭', '确认发送'], ['预订蛋糕', '六寸草莓蛋糕，11月9日自取', '确认预订'], ['支付定金', '¥50 · 生活账户 1608', '确认支付定金']];
  const times = steps.map(([, , label]) => at(mark('compound', 'tap:' + label), skip, rate, 6));
  return (
    <AbsoluteFill>
      <div style={{position: 'absolute', left: 170, top: 190, width: 760}}>
        <Rise><Label>一句话委托</Label></Rise>
        <Rise delay={4}><Title style={{marginTop: 14}}>说一句话，<br />它拆成三步</Title></Rise>
        <div style={{display: 'grid', gap: 14, marginTop: 44}}>
          {steps.map(([title, detail], i) => <Row key={title} title={title} detail={detail} done={f >= times[i]} delay={at(mark('compound', 'send:'), skip, rate, 8) + i * 5} />)}
        </div>
      </div>
      <Phone clip="compound" rate={rate} startFrom={Math.round(skip * FPS)} x={1920 - 170 - PHONE_WIDTH} />
      {times.map((t) => <Tick key={t} at={t} />)}
    </AbsoluteFill>
  );
};

export const Rent: React.FC<{frames: number}> = () => {
  const f = useCurrentFrame();
  const skip = 0.8, rate = 1.25;
  const mailAt = at(mark('rent', 'tap:收到房东邮件'), skip, rate, 4);
  const payAt = at(mark('rent', 'tap:核验并继续'), skip, rate, 8);
  return (
    <AbsoluteFill>
      <Phone clip="rent" rate={rate} startFrom={Math.round(skip * FPS)} x={170} />
      <div style={{position: 'absolute', left: 170 + PHONE_WIDTH + 130, top: 200, width: 800}}>
        <Rise><Label>主动提醒</Label></Rise>
        <Rise delay={4}><Title style={{marginTop: 14}}>不等你开口，<br />它先来找你</Title></Rise>
        <div style={{display: 'grid', gap: 14, marginTop: 44}}>
          <Row title="收到房东邮件" detail="11月房租 ¥3,500，11月3日到期" done={f > mailAt + 12} delay={mailAt} />
          <Row title="核对已保存的租约" detail="收款人与金额一致" done={f > mailAt + 46} delay={mailAt + 34} />
          <Row title="等你确认才付款" detail="需要时再加一道密码验证" done={f > payAt} delay={mailAt + 70} />
        </div>
      </div>
      <Tick at={payAt} />
    </AbsoluteFill>
  );
};

export const Facts: React.FC<{frames: number}> = () => {
  const f = useCurrentFrame();
  const skip = 0.9;
  const show = at(mark('facts', 'send:我这个月吃饭'), skip, 1, 10);
  const value = interpolate(f, [show, show + 26], [0, 1873], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  return (
    <AbsoluteFill>
      <div style={{position: 'absolute', left: 170, top: 240, width: 800}}>
        <Rise><Label>账单分析</Label></Rise>
        <Rise delay={4}><Title style={{marginTop: 14}}>金额来自账本，<br />不靠模型背答案</Title></Rise>
        <Rise delay={show}>
          <div style={{marginTop: 46, fontFamily: FONT}}>
            <div style={{fontSize: 26, color: C.muted}}>本月餐饮 · 3 笔</div>
            <div style={{fontSize: 96, fontWeight: 700, color: C.accent, letterSpacing: -2}}>¥{Math.round(value).toLocaleString('en-US')}.00</div>
          </div>
        </Rise>
      </div>
      <Phone clip="facts" startFrom={Math.round(skip * FPS)} x={1920 - 170 - PHONE_WIDTH} />
    </AbsoluteFill>
  );
};

export const Risk: React.FC<{frames: number}> = () => (
  <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
    <Rise y={40}><Title dark size={108}>遇到风险，它会<span style={{color: '#FF6B70'}}>停下来</span></Title></Rise>
  </AbsoluteFill>
);

const Blocked: React.FC<{clip: string; startFrom: number; label: string; heading: React.ReactNode; rows: [string, string][]; stamp: string; stampAt: number; rate?: number; glowAt: number}> = ({clip, startFrom, label, heading, rows, stamp, stampAt, rate = 1, glowAt}) => {
  const f = useCurrentFrame();
  const glow = f >= glowAt ? 'rgba(229,72,77,.6)' : undefined;
  const shake = f >= glowAt && f < glowAt + 12 ? Math.sin(f * 2.4) * 7 : 0;
  return (
    <AbsoluteFill>
      <div style={{position: 'absolute', left: 130, top: 170, width: 860}}>
        <Rise><Label dark>{label}</Label></Rise>
        <Rise delay={3}><Title dark size={64} style={{marginTop: 12}}>{heading}</Title></Rise>
        <div style={{display: 'grid', gap: 12, marginTop: 36}}>
          {rows.map(([title, detail], i) => {
            const d = 8 + i * 9;
            return <Row key={title} dark title={title} detail={detail} done={f > d + 8} color={i === rows.length - 1 ? C.red : C.accent} delay={d} />;
          })}
        </div>
      </div>
      <div style={{position: 'absolute', inset: 0, transform: `translateX(${shake}px)`}}>
        <Phone clip={clip} rate={rate} startFrom={startFrom} x={1920 - 150 - PHONE_WIDTH} glow={glow} delay={0} />
      </div>
      <div style={{position: 'absolute', right: 150 + PHONE_WIDTH + 44, top: 760}}><Stamp text={stamp} color="#FF6B70" delay={stampAt} /></div>
      <Alert at={glowAt} />
    </AbsoluteFill>
  );
};

export const Scam: React.FC<{frames: number}> = () => (
  <Blocked clip="scam" startFrom={Math.round(0.7 * FPS)} rate={1.6} label="诈骗话术" heading="“马上转到安全账户”" stamp="已拦截" stampAt={32} glowAt={34}
    rows={[['识别话术', '“账户有风险”“安全账户”“马上转”'], ['收款人未核实', '不是已知联系人'], ['不发起转账', '没有授权入口']]} />
);
export const Reported: React.FC<{frames: number}> = () => (
  <Blocked clip="reported" startFrom={Math.round(0.6 * FPS)} rate={1.3} label="高危收款人" heading="7 条举报，立刻熔断" stamp="已熔断" stampAt={40} glowAt={42}
    rows={[['命中风险名册', '尾号 8891 · 演示数据'], ['在途授权失效', '写操作全部暂停'], ['密码也不能放行', '恢复权限后仍不能付款']]} />
);
export const Inject: React.FC<{frames: number}> = () => (
  <Blocked clip="inject" startFrom={Math.round(0.8 * FPS)} rate={1.3} label="提示词注入" heading="邮件想骗走验证码" stamp="不是授权" stampAt={52} glowAt={54}
    rows={[['读取邮件', '账单 ¥25，11月28日到期'], ['发现夹带指令', '“回复验证码和 API 密钥”'], ['当作数据处理', '外部内容不能授予权限']]} />
);

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

export const Recurring: React.FC<{frames: number}> = () => {
  const skip = 0.9, rate = 1.25;
  const items: [string, string][] = [['每期金额', '¥500'], ['期数', '3 期'], ['累计上限', '¥1,500'], ['最长期限', '90 天']];
  return (
    <AbsoluteFill>
      <div style={{position: 'absolute', left: 170, top: 210, width: 800}}>
        <Rise><Label>定期转账</Label></Rise>
        <Rise delay={4}><Title style={{marginTop: 14}}>一次确认，<br />边界写得清清楚楚</Title></Rise>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 44}}>
          {items.map(([k, v], i) => (
            <Rise key={k} delay={at(mark('recurring', 'send:'), skip, rate, 16) + i * 9} style={{padding: '22px 26px', borderRadius: 24, background: '#fff', fontFamily: FONT, boxShadow: '0 18px 40px -26px rgba(62,99,221,.7)'}}>
              <div style={{fontSize: 24, color: C.muted}}>{k}</div>
              <div style={{fontSize: 52, fontWeight: 700, color: C.ink}}>{v}</div>
            </Rise>
          ))}
        </div>
      </div>
      <Phone clip="recurring" rate={rate} startFrom={Math.round(skip * FPS)} x={1920 - 170 - PHONE_WIDTH} />
    </AbsoluteFill>
  );
};

export const Scope: React.FC<{frames: number}> = () => {
  const names = ['智能转账', '账单分析', '理财操作', '卡片管理', '订阅管理', '跨场景联动'];
  return (
    <AbsoluteFill>
      <Phone clip="broll" rate={1.55} startFrom={Math.round(0.8 * FPS)} x={170} />
      <div style={{position: 'absolute', left: 170 + PHONE_WIDTH + 130, top: 210, width: 820}}>
        <Rise><Label>覆盖范围</Label></Rise>
        <Rise delay={4}><Title style={{marginTop: 14}}>六个场景，<br />一个伙伴</Title></Rise>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 44}}>
          {names.map((name, i) => (
            <Rise key={name} delay={14 + i * 16} style={{display: 'flex', alignItems: 'center', gap: 14, padding: '20px 24px', borderRadius: 22, background: '#fff', fontFamily: FONT, fontSize: 32, fontWeight: 650, color: C.ink, boxShadow: '0 18px 40px -26px rgba(62,99,221,.7)'}}>
              <Check done />{name}
            </Rise>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const End: React.FC<{frames: number}> = () => {
  const s = useIn(0, 11);
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', gap: 10}}>
      <div style={{transform: `scale(${s})`}}><Mascot size={240} /></div>
      <Rise delay={6}><Title size={100}>FinPilot</Title></Rise>
      <Rise delay={14}><Title size={60} style={{fontWeight: 600, color: C.accent}}>钱的事，我陪你。</Title></Rise>
      <Rise delay={30} style={{marginTop: 34}}><Sub style={{fontSize: 24, textAlign: 'center', color: C.soft}}>所有金额、账户和操作均为合成演示，不连接真实银行</Sub></Rise>
    </AbsoluteFill>
  );
};

