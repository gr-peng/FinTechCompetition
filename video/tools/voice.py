import json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
V='zh-CN-XiaoxiaoNeural'
L=[
('hook','如果 AI 能替你动钱，最重要的不是它有多聪明，而是它知道什么时候该停下来。'),
('intro','这是 FinPilot，你的个人财务伙伴。'),
('compound','你只要说一句话。发短信、订蛋糕、付定金，它拆成三步，每一步都等你点头。'),
('rent','它也会主动找你。房东的邮件到了，它先核对租约，再提醒你付房租。没有你的确认，一分钱都不动。'),
('facts','问账单也一样。金额由本地账本计算，不靠模型背答案。'),
('risk','遇到风险，它会停下来。'),
('scam','“安全账户”是诈骗话术，直接拦截。'),
('reported','收款账户被多人举报，立刻熔断，输对密码也放不行。'),
('inject','邮件里夹带指令，想骗验证码？外部内容只是数据，不是授权。'),
('arch','因为在 FinPilot 里，模型只能提议，不能动钱。账本不发给模型，风控在本地判断，你确认之后，程序才执行。'),
('recurring','定期转账也有边界。一次确认，写清每期金额、期数和累计上限，最长九十天。'),
('scope','转账、账单、理财、卡片、订阅，再到跨场景联动，都在一个伙伴里完成。'),
('end','FinPilot。钱的事，我陪你。'),
]
(ROOT/'public/voice').mkdir(parents=True,exist_ok=True)
out=[]
for k,t in L:
    p=str(ROOT/f'public/voice/{k}.mp3')
    subprocess.run([sys.executable,'-m','edge_tts','--voice',V,'--rate=+6%','--text',t,'--write-media',p],check=True,capture_output=True)
    d=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',p]))
    out.append({'id':k,'text':t,'dur':round(d,3)})
json.dump(out,open(ROOT/'src/voice.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
print(sum(x['dur'] for x in out),[(x['id'],x['dur']) for x in out])
