import numpy as np, wave
from pathlib import Path
SR=44100
OUT=Path(__file__).resolve().parents[1]/'public/audio';OUT.mkdir(parents=True,exist_ok=True)
def save(p,x):
    x=np.clip(x,-1,1); a=(x*32767).astype(np.int16)
    w=wave.open(str(OUT/p),'wb');w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes(a.tobytes());w.close()
def env(n,a,r):
    e=np.ones(n);A=int(a*SR);R=int(r*SR);e[:A]=np.linspace(0,1,A);e[-R:]=np.linspace(1,0,R);return e
# Warm pad: slow chord loop, soft sine stacks with slight detune.
T=100;bar=6.0;n=int(T*SR);t=np.arange(n)/SR
chords=[[130.81,196.0,246.94,329.63],[110.0,164.81,220.0,261.63],[87.31,174.61,220.0,261.63],[98.0,146.83,196.0,293.66]]
L=np.zeros(n);Rt=np.zeros(n)
for i in range(int(T/bar)+1):
    s=int(i*bar*SR);m=int((bar+2.5)*SR);e=min(n,s+m);tt=(np.arange(e-s))/SR;E=env(m,1.8,2.5)[:e-s]
    for f in chords[i%4]:
        for det,pan in((.997,.8),(1.003,.2)):
            v=np.sin(2*np.pi*f*det*tt)+.25*np.sin(4*np.pi*f*det*tt)
            L[s:e]+=v*E*pan*.11;Rt[s:e]+=v*E*(1-pan)*.11
# Gentle pluck arpeggio.
rng=np.random.default_rng(7);step=bar/8
for i in range(int(T/step)):
    c=chords[int(i*step/bar)%4];f=c[i%4]*2;s=int(i*step*SR);m=int(1.6*SR);e=min(n,s+m);tt=np.arange(e-s)/SR
    v=np.sin(2*np.pi*f*tt)*np.exp(-tt*3.2)*.05*(.7+.3*rng.random());p=.5+.3*np.sin(i)
    L[s:e]+=v*p;Rt[s:e]+=v*(1-p)
x=np.stack([L,Rt],1);x/=np.abs(x).max();save('music.wav',x*.8)
def mono(y): return np.stack([y,y],1)
tt=np.arange(int(.14*SR))/SR
save('tick.wav',mono(np.sin(2*np.pi*1320*tt)*np.exp(-tt*38)*.5+np.sin(2*np.pi*1980*tt)*np.exp(-tt*50)*.2))
tt=np.arange(int(.9*SR))/SR
save('alert.wav',mono((np.sin(2*np.pi*82*tt)*np.exp(-tt*4.5)*.8+np.sin(2*np.pi*233*tt)*np.exp(-tt*9)*.3)))
tt=np.arange(int(.5*SR))/SR;nz=np.random.default_rng(1).normal(size=len(tt));k=np.ones(90)/90
save('whoosh.wav',mono(np.convolve(nz,k,'same')*np.sin(np.pi*tt/.5)**2*1.1))
print('ok')
