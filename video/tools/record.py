"""Drive the app's offline demo through docs/DEMO-PROMPTS.zh-CN.md and record each flow.

Every beat waits for its narration, so the recording plays close to real time under the voice.
"""
import time, asyncio, base64, json, os, shutil, subprocess, sys, re, tempfile
from playwright.async_api import async_playwright
PORT=65295; ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT=f'{ROOT}/public/clips'; RAW=tempfile.mkdtemp(prefix='finpilot-raw-'); os.makedirs(OUT,exist_ok=True)
VOICE={x['id']:x['dur'] for x in json.load(open(f'{ROOT}/src/voice.json',encoding='utf-8'))}
PAUSE=.62
READ=2300  # Scene five: how long a card stays up before the choice is made.
TAP="""addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='.fp-tap{position:fixed;z-index:99999;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(62,99,221,.28);box-shadow:0 0 0 2px rgba(62,99,221,.55);pointer-events:none;animation:fptap .5s ease-out forwards}@keyframes fptap{from{transform:scale(.5);opacity:1}to{transform:scale(1.5);opacity:0}}.fp-pick{outline:3px solid rgba(62,99,221,.8)!important;outline-offset:2px}summary.fp-pick{border-radius:12px}.fp-glow{outline:3px solid rgba(62,99,221,.6)!important;outline-offset:4px;border-radius:24px}[data-offline-password-hint]{display:none!important}';document.head.append(s);const tidy=[['演示密码不匹配','密码不匹配'],['虚构研究产品。','']];new MutationObserver(()=>{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode())for(const [a,b] of tidy)if(n.data.includes(a))n.data=n.data.replace(a,b)}).observe(document.body,{childList:true,subtree:true,characterData:true});addEventListener('pointerdown',e=>{const d=document.createElement('i');d.className='fp-tap';d.style.left=e.clientX+'px';d.style.top=e.clientY+'px';document.body.append(d);setTimeout(()=>d.remove(),600)},true)});"""
class Clip:
    def __init__(s,page,name): s.p=page; s.name=name; s.marks=[]; s.t0=time.time(); s.cur=None; s.started=0
    def mark(s,label): s.marks.append([label,round(time.time()-s.t0,2)])
    async def wait(s,ms): await s.p.wait_for_timeout(ms)
    async def settle(s):
        if s.cur:
            left=VOICE[s.cur]+PAUSE-(time.time()-s.started)
            if left>0: await s.wait(int(left*1000))
    async def beat(s,voice_id):
        await s.settle(); s.mark('beat:'+voice_id); s.cur=voice_id; s.started=time.time()
    async def end(s): await s.settle(); s.mark('end')
    async def say(s,text):
        i=s.p.locator('#chat-input'); await i.click(); await i.press_sequentially(text,delay=38); await s.wait(300)
        s.mark('tap:send'); await s.p.locator('[aria-label="发送消息"]').click(); await s.wait(200)
    async def tap(s,label,timeout=8000,first=False,read=320):
        l=s.p.locator('main button, main a, main summary, .event-menu button, #overlay button, [data-action]').filter(has_text=re.compile(label))
        b=l.first if first else l.last
        await b.wait_for(state='visible',timeout=timeout); await s.wait(read)
        await b.evaluate("e=>{e.classList.add('fp-pick');setTimeout(()=>e.classList.remove('fp-pick'),480)}"); await s.wait(280)
        # The chat re-renders while replies arrive, so resolve the element at click time.
        s.mark('tap:'+label); await b.click(timeout=timeout)
    async def glow(s,text,ms=1000):
        await s.p.get_by_text(text).first.evaluate("(e,ms)=>{const c=e.closest('button,a,section,.card')||e;c.classList.add('fp-glow');setTimeout(()=>c.classList.remove('fp-glow'),ms)}",ms); await s.wait(ms+60)
    async def nav(s,label):
        await s.wait(300); s.mark('tap:'+label); await s.p.locator('nav a, nav button').filter(has_text=label).first.click()
    async def menu(s,label):
        s.mark('tap:plus'); await s.p.locator('[data-action="event-menu"]').click(); await s.wait(500); await s.tap(label)
    async def pw(s,code='123456',pause=240):
        i=s.p.locator('input[type=password]').last
        await i.wait_for(state='visible',timeout=5000); await s.wait(pause); await i.click(); await i.press_sequentially(code,delay=70); await s.wait(pause); await s.tap('核验并继续')
    async def see(s,text): await s.p.get_by_text(text).last.wait_for(state='visible',timeout=8000)
NEW='给陈宇转300元，卡号0000000000006217。'
async def s1_new(c):
    await c.wait(500); await c.beat('c1a'); await c.wait(1500); await c.say(NEW)
    await c.beat('c1b'); await c.see('首次向这张卡转账')
    await c.beat('c1c'); await c.wait(500); await c.tap('确认这一次转账'); await c.pw(); await c.see('转账成功')
    await c.end()
async def s1_lock(c):
    await c.say(NEW); await c.tap('确认这一次转账'); await c.wait(800)
    await c.beat('c1d')
    for _ in range(3): await c.pw('000000',pause=120); await c.wait(350)
    await c.see('账户已冻结10分钟'); c.mark('stamp'); await c.end()
async def s1_bad(c):
    await c.wait(400); await c.beat('c1e'); await c.say('给闲鱼卖家转2000元，卡号0000000000008891。'); await c.see('收款账户有风险'); c.mark('stamp'); await c.end()
async def s2_mail(c):
    await c.wait(400); await c.beat('c2a'); await c.wait(900); await c.menu('收到账单邮件'); await c.see('管理员已批准')
    await c.beat('c2b'); await c.wait(600); c.mark('stamp')
    await c.beat('c2c'); await c.wait(1200); await c.tap('输入密码'); await c.pw(); await c.see('仍然有风险')
    await c.beat('c2d'); await c.tap('放弃处理'); await c.see('已放弃处理'); c.mark('stamp'); await c.end()
async def s3_rent(c):
    await c.wait(400); await c.beat('c3a'); await c.wait(1000); await c.menu('收到房东邮件'); await c.see('确认转账')
    await c.beat('c3b'); await c.wait(1500); await c.tap('确认转账'); await c.pw(); await c.see('这次安排已完成'); await c.end()
async def s3_sub(c):
    await c.wait(400); await c.beat('c3c'); await c.wait(800); await c.menu('会员即将到期'); await c.see('本次选择')
    await c.beat('c3d'); await c.say('云音乐这次续一个月就好。'); await c.tap('确认续费'); await c.see('这次安排已完成'); await c.end()
async def s3_sub2(c):
    await c.menu('会员即将到期'); await c.see('本次选择'); await c.wait(800)
    await c.beat('c3e'); await c.say('下个月不续了，本月的先留着。'); await c.wait(1500); await c.tap('确认取消续费'); await c.see('这次安排已完成'); await c.end()
async def s4_ride(c):
    await c.wait(400); await c.beat('c4a'); await c.wait(900); await c.say('跟妈妈说我周六中午回家吃饭，帮我约辆周六上午从学校回家的顺风车，出发前记得提醒我。'); await c.see('上午9点')
    await c.beat('c4b')
    for x in ['上午9点','学校东门','锦绣小区南门','80元']: await c.tap(x); await c.wait(500)
    await c.see('确认发送')
    await c.beat('c4c'); await c.wait(900); await c.tap('确认发送'); await c.see('确认预约')
    await c.beat('c4d'); await c.wait(1600); await c.tap('确认预约'); await c.see('出发提醒')
    await c.beat('c4e')
    await c.beat('c4f'); await c.wait(1700); c.mark('tap:advance'); await c.p.evaluate("window.postMessage({type:'finpilot-advance-ride-reminder'},location.origin)"); await c.see('还有一小时出发'); await c.end()
async def s5_wealth(c):
    await c.wait(400); await c.beat('c5a'); await c.wait(900); await c.say('手里有点钱，想理一理。'); await c.see('为一个目标攒钱')
    await c.beat('c5b'); await c.tap('让闲钱赚点收益',read=1100); await c.see('可进一步安排')
    await c.beat('c5c')
    for x in ['^旅行','¥5,000','半年']: await c.tap(x,read=READ)
    await c.see('你有多少投资经验')
    await c.beat('c5d')
    for x in ['了解基金或理财','可接受小幅亏损','收入稳定但有压力']: await c.tap(x,read=READ)
    await c.see('先比较，再决定')
    await c.beat('c5e'); await c.tap('费用、赎回与资料',first=True,read=READ); await c.wait(1200)
    await c.beat('c5f'); await c.tap('选择这款',first=True,read=900); await c.tap('¥3,000',read=READ); await c.tap('确认申购并验证',read=READ); await c.pw(); await c.see('已买入')
    await c.beat('c5g'); await c.wait(400); await c.nav('投资'); await c.see('理财持仓'); await c.wait(1500); await c.tap('银行理财'); await c.see('可用余额'); await c.end()
async def s5_save(c):
    await c.wait(400); await c.beat('c5h'); await c.wait(500); await c.say('手里有点钱，想理一理。')
    for x in ['为一个目标攒钱','^旅行','¥600','¥20','确认安排']: await c.tap(x,read=1800)
    await c.beat('c5i'); await c.nav('财务'); await c.wait(700); await c.tap('图表'); await c.wait(500); await c.tap('预算'); await c.end()
async def today(c):
    await c.nav('今天'); await c.wait(900)
    await c.beat('t1'); await c.wait(3500)
    for x in ['工资到账','本月房租','旅行预算','可用余额']: await c.glow(x)
    await c.beat('t2'); await c.tap('查看安排',read=500); await c.end()
async def invest(c):
    await c.nav('投资'); await c.wait(900)
    await c.beat('i1'); await c.wait(3000); await c.tap('风险分析'); await c.see('风险承受建议'); await c.wait(1800)
    await c.beat('i2'); await c.tap('完成'); await c.wait(400); await c.tap('银行理财'); await c.wait(1500); await c.tap('投资研究'); await c.end()
async def broll(c):
    await c.wait(400); await c.beat('scope'); await c.nav('财务'); await c.wait(700); await c.tap('图表'); await c.wait(1500); await c.tap('账户'); await c.wait(1100)
    await c.end()
CLIPS={'today':today,'s1_new':s1_new,'s1_lock':s1_lock,'s1_bad':s1_bad,'s2_mail':s2_mail,'s3_rent':s3_rent,'s3_sub':s3_sub,'s3_sub2':s3_sub2,'s4_ride':s4_ride,'s5_wealth':s5_wealth,'s5_save':s5_save,'invest':invest,'broll':broll}
MARKS_PATH=f'{ROOT}/src/marks.json'
MARKS=json.load(open(MARKS_PATH,encoding='utf-8'))
async def one(browser,name,fn):
    raw=f'{RAW}/{name}'; shutil.rmtree(raw,ignore_errors=True); os.makedirs(raw)
    ctx=await browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,locale='zh-CN')
    await ctx.add_init_script(TAP); page=await ctx.new_page()
    await page.goto(f'http://127.0.0.1:{PORT}/?app=1&offline=1&session=rec{name}{int(time.time())}#/bot'); await page.wait_for_timeout(1200)
    cdp=await ctx.new_cdp_session(page); frames=[]
    async def on(ev):
        n=len(frames); p=f'{raw}/{n:06d}.jpg'; open(p,'wb').write(base64.b64decode(ev['data'])); frames.append((p,ev['metadata']['timestamp']))
        await cdp.send('Page.screencastFrameAck',{'sessionId':ev['sessionId']})
    cdp.on('Page.screencastFrame',lambda ev:asyncio.ensure_future(on(ev)))
    await cdp.send('Page.startScreencast',{'format':'jpeg','quality':92,'maxWidth':780,'maxHeight':1688,'everyNthFrame':1})
    c=Clip(page,name); err=None
    try: await fn(c)
    except Exception as e: err=str(e)[:300]
    await c.wait(600); await cdp.send('Page.stopScreencast'); stopped=time.time(); await c.wait(200)
    await page.screenshot(path=f'{RAW}/{name}.png'); txt=await page.locator('main').inner_text(); await ctx.close()
    frames.sort(key=lambda f:f[1])
    # Screencast only sends changed frames, so the video starts at the first frame and the last one is held.
    shift=c.t0-frames[0][1]
    c.marks=[[label,round(t+shift,2)] for label,t in c.marks]
    lst=f'{raw}/list.txt'
    with open(lst,'w') as f:
        for i,(p,t) in enumerate(frames):
            d=(frames[i+1][1]-t) if i+1<len(frames) else stopped-t+1
            f.write(f"file '{p}'\nduration {max(d,.001):.4f}\n")
        f.write(f"file '{frames[-1][0]}'\n")
    out=f'{OUT}/{name}.mp4'
    subprocess.run(['ffmpeg','-y','-v','error','-f','concat','-safe','0','-i',lst,'-vf','fps=30,scale=780:1688:flags=lanczos,format=yuv420p','-c:v','libx264','-crf','15','-preset','slow','-g','15',out],check=True)
    MARKS[name]=c.marks
    print(f'== {name}: {len(frames)} frames {frames[-1][1]-frames[0][1]:.1f}s shift={shift:.2f} err={err}\n{txt[-200:]!r}',flush=True)
async def main():
    names=sys.argv[1:] or list(CLIPS)
    async with async_playwright() as p:
        b=await p.chromium.launch(headless=True,args=['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'])
        for n in names: await one(b,n,CLIPS[n])
        await b.close()
    json.dump(MARKS,open(MARKS_PATH,'w',encoding='utf-8'),ensure_ascii=False,indent=0)
asyncio.run(main())
