import time, asyncio, base64, json, os, shutil, subprocess, sys, re, tempfile
from playwright.async_api import async_playwright
PORT=65295; ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT=f'{ROOT}/public/clips'; RAW=tempfile.mkdtemp(prefix='finpilot-raw-'); os.makedirs(OUT,exist_ok=True)
KEY=os.environ.get('FINPILOT_KEY','fake-key-for-recording')
TAP="""addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='.fp-tap{position:fixed;z-index:99999;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(62,99,221,.28);box-shadow:0 0 0 2px rgba(62,99,221,.55);pointer-events:none;animation:fptap .5s ease-out forwards}@keyframes fptap{from{transform:scale(.5);opacity:1}to{transform:scale(1.5);opacity:0}}';document.head.append(s);addEventListener('pointerdown',e=>{const d=document.createElement('i');d.className='fp-tap';d.style.left=e.clientX+'px';d.style.top=e.clientY+'px';document.body.append(d);setTimeout(()=>d.remove(),600)},true)});"""
class Clip:
    def __init__(s,page,name): s.p=page; s.name=name; s.marks=[]; s.t0=time.time()
    def mark(s,label): s.marks.append([label,round(time.time()-s.t0,2)])
    async def wait(s,ms): await s.p.wait_for_timeout(ms)
    async def say(s,text):
        i=s.p.locator('#chat-input'); await i.click(); await i.press_sequentially(text,delay=26); await s.wait(350)
        s.mark('send:'+text[:6]); await s.p.locator('[aria-label="发送消息"]').click(); await s.wait(300)
    async def tap(s,label,timeout=6000):
        b=s.p.locator('main button, main a, .event-menu button, [data-action]').filter(has_text=re.compile(label)).last
        await b.wait_for(state='visible',timeout=timeout); await s.wait(350)
        # The chat re-renders while replies arrive, so resolve the element at click time.
        s.mark('tap:'+label); await b.click(timeout=timeout)
    async def pw(s):
        i=s.p.locator('input[type=password]').last
        await i.wait_for(state='visible',timeout=4000); await s.wait(500); await i.click(); await i.press_sequentially('123456',delay=90); await s.wait(300); await s.tap('核验并继续')
    async def maybe_pw(s):
        await s.wait(900)
        if await s.p.locator('input[type=password]').count(): await s.pw()
    async def text(s): return await s.p.locator('main').inner_text()
async def compound(c):
    await c.wait(700); await c.say('给妈妈发短信：周末我回家吃饭。另外帮我预订11月9日下午4点自取的六寸草莓蛋糕，用生活账户1608付定金。')
    await c.wait(2200)
    for label in ['确认发送','确认预订','确认支付定金']:
        await c.tap(label); await c.maybe_pw(); await c.wait(2100)
    await c.wait(1500)
async def rent(c):
    await c.wait(600); await c.p.locator('[data-action="event-menu"]').click(); await c.wait(500); await c.tap('收到房东邮件'); await c.wait(2600)
    await c.say('这次房租从生活账户1608付，只处理11月这一期。'); await c.wait(2200)
    await c.tap('确认|授权'); await c.maybe_pw(); await c.wait(2500)
async def facts(c):
    await c.wait(500); await c.say('我这个月吃饭花了多少钱？'); await c.wait(2400); await c.say('看看过去一年的每月花费趋势。'); await c.wait(3200)
async def scam(c):
    await c.wait(500); await c.say('有人说我的账户有风险，让我马上把10000元转到他发来的安全账户。'); await c.wait(3500)
async def reported(c):
    await c.wait(500); await c.say('给闲鱼卖家卡号尾号8891转2000元。'); await c.wait(4000)
async def inject(c):
    await c.wait(500); await c.p.locator('[data-action="event-menu"]').click(); await c.wait(500); await c.tap('收到账单邮件'); await c.wait(5000)
async def recurring(c):
    await c.wait(500); await c.say('每月给妈妈转500元，从工资账户走，一共3期。'); await c.wait(3200)
    await c.tap('授权并'); await c.maybe_pw(); await c.wait(2500)
async def broll(c):
    await c.wait(900); await c.p.evaluate("location.hash='#/finance'"); await c.wait(1600)
    await c.p.mouse.move(195,500)
    for i in range(10): await c.p.mouse.wheel(0,45); await c.wait(40)
    await c.wait(700); await c.tap('图表'); await c.wait(2000)
    await c.p.evaluate("location.hash='#/investment'"); await c.wait(1600); await c.tap('银行理财'); await c.wait(1700); await c.tap('投资研究'); await c.wait(1900)
CLIPS={'compound':compound,'rent':rent,'facts':facts,'scam':scam,'reported':reported,'inject':inject,'recurring':recurring,'broll':broll}
MARKS=json.load(open(f'{ROOT}/src/marks.json',encoding='utf-8'))
async def one(browser,name,fn):
    raw=f'{RAW}/{name}'; shutil.rmtree(raw,ignore_errors=True); os.makedirs(raw)
    ctx=await browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,locale='zh-CN')
    await ctx.add_init_script(TAP); page=await ctx.new_page()
    url=f'http://127.0.0.1:{PORT}/?app=1&session=rec{name}{int(time.time())}#/'+('today' if name=='broll' else 'bot')
    await page.goto(url); await page.wait_for_timeout(1200)
    await page.evaluate("""async key=>{const s=await (await fetch('/api/session')).json();await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({provider:'micu',base_url:'https://www.micuapi.ai/v1',model:'deepseek-v4-flash-0731',key})})}""",KEY)
    await page.wait_for_timeout(500)
    cdp=await ctx.new_cdp_session(page); frames=[]
    async def on(ev):
        n=len(frames); p=f'{raw}/{n:06d}.jpg'; open(p,'wb').write(base64.b64decode(ev['data'])); frames.append((p,ev['metadata']['timestamp']))
        await cdp.send('Page.screencastFrameAck',{'sessionId':ev['sessionId']})
    cdp.on('Page.screencastFrame',lambda ev:asyncio.ensure_future(on(ev)))
    await cdp.send('Page.startScreencast',{'format':'jpeg','quality':92,'maxWidth':780,'maxHeight':1688,'everyNthFrame':1})
    c=Clip(page,name); err=None
    try: await fn(c)
    except Exception as e: err=str(e)[:300]
    await c.wait(600); await cdp.send('Page.stopScreencast'); await c.wait(200)
    await page.screenshot(path=f'{RAW}/{name}.png'); txt=await c.text(); await ctx.close()
    frames.sort(key=lambda f:f[1])
    lst=f'{raw}/list.txt'
    with open(lst,'w') as f:
        for i,(p,t) in enumerate(frames):
            d=(frames[i+1][1]-t) if i+1<len(frames) else 10
            f.write(f"file '{p}'\nduration {max(d,.001):.4f}\n")
        f.write(f"file '{frames[-1][0]}'\n")
    out=f'{OUT}/{name}.mp4'
    subprocess.run(['ffmpeg','-y','-v','error','-f','concat','-safe','0','-i',lst,'-vf','fps=30,scale=780:1688:flags=lanczos,format=yuv420p','-c:v','libx264','-crf','15','-preset','slow','-g','15',out],check=True)
    dur=frames[-1][1]-frames[0][1]
    MARKS[name]=c.marks
    print(f'== {name}: {len(frames)} frames {dur:.1f}s err={err}\n{txt[-260:]!r}',flush=True)
async def main():
    names=sys.argv[1:] or list(CLIPS)
    async with async_playwright() as p:
        b=await p.chromium.launch(headless=True,args=['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'])
        for n in names: await one(b,n,CLIPS[n])
        await b.close()
    json.dump(MARKS,open(f'{ROOT}/src/marks.json','w',encoding='utf-8'),ensure_ascii=False,indent=0)
asyncio.run(main())
