import json,re,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
V='zh-CN-XiaoxiaoNeural'
L=[
('hook','如果 AI 能替你动钱，最重要的不是它有多聪明，而是它知道什么时候该停下来。'),
('intro','这是 FinPilot，你的个人财务伙伴。'),
('t1','打开 App，今天页先把要紧的事放在一起：工资到账、这个月的房租、旅行预算和账户余额。'),
('t2','点查看安排，这笔工资已经整理成待确认的任务卡。接下来看五个场景，它怎么替你办事，又怎么守住底线。'),
('c1a','第一个场景，给新收款人转账。只要说一句话，带上卡号。'),
('c1b','它先查转账记录，发现是第一次转给这张卡，标为中风险，请你核对。'),
('c1c','确认之后还要验证身份，密码正确，这笔钱才转出去。'),
('c1d','如果连续输错三次密码，账户冻结十分钟，钱没有转出。'),
('c1e','换成被多人标记的闲鱼卖家，它直接停止转账。这和普通新收款人不同，输对密码也放不行。'),
('c2a','第二个场景，收到一封账单邮件。它先给出摘要：云存储二十五元，十一月二十八日到期。'),
('c2b','但邮件里夹带了要求：回复验证码和 API 密钥，还声称管理员已批准。这段内容被标成了红色。'),
('c2c','密码只用来核对本人，不批准邮件里的要求。验证之后，它仍然提示可能是诈骗。'),
('c2d','点放弃处理。邮件没有回复，信息也没有发出去。'),
('c3a','第三个场景，它会主动找你。房东邮件到了：十一月房租三千五百元，三号之前处理。'),
('c3b','收款人和金额都整理好了。你确认并验证密码之后，才会付款。'),
('c3c','会员快到期时也一样。它问你，这次只续一个月，还是取消下次续费。'),
('c3d','说一句这次续一个月就好，它只处理本期二十五元。'),
('c3e','说下个月不续了，同样要你确认。本期权益保留，不退款。'),
('c4a','第四个场景，一句话三件事：告诉妈妈周六回家吃饭，约一辆顺风车，出发前提醒我。'),
('c4b','三件事它都记下了，再逐项问清出发时间、上下车地点和车费上限。'),
('c4c','短信内容先给你看，确认了才发送。'),
('c4d','顺风车单独确认。这一步只是预约，不扣车费。'),
('c4e','完成后结果很清楚：短信发了，车约好了，车费未支付，提醒也设好了。'),
('c4f','到了提醒时间，它主动告诉你，还有一小时出发。'),
('c5a','第五个场景，最模糊的一句话：手里有点钱，想理一理。它不急着推荐产品，先问你想做什么。'),
('c5b','选让闲钱赚点收益。金额来自账户和账单，现金、生活预算、备用金分开算清楚。'),
('c5c','旅行要用的钱先留出来。选旅行，预留五千元，这笔闲钱大概半年不用。'),
('c5d','接下来是三道风险问答：投资经验、能接受的本金波动、收入和备用金情况。'),
('c5e','然后比较两款产品，费用、赎回时间和资料日期都能展开看。'),
('c5f','选清泉灵活，买入三千元。核对产品、金额和剩余资金，验证密码之后，显示已买入。'),
('c5g','投资页多了这笔理财持仓，可用余额也只扣了一次。'),
('c5h','如果想为目标存钱，同一句话也能开始。选旅行，目标六百元，每天存二十元，确认后才创建储蓄罐。'),
('c5i','财务页的预算里，看到的是同一个储蓄罐。'),
('i1','投资页分三栏。个人持仓看成本、市值和盈亏，还能根据十二个月的收支记录做风险分析。'),
('i2','银行理财负责申购和赎回，投资研究可以查历史行情。'),
('scope','账单图表、卡片申请和管理，也都在同一个伙伴里。'),
('arch','因为在 FinPilot 里，模型只能提议，不能动钱。账本不发给模型，风控在本地判断，你确认之后，程序才执行。'),
('end','FinPilot。钱的事，我陪你。'),
]
(ROOT/'public/voice').mkdir(parents=True,exist_ok=True)
def duration(p):
    return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',p]))
def complete(text,srt,dur):
    # A dropped connection still exits 0 and leaves partial audio, so compare it with the sentence timings.
    cues=re.findall(r'--> (\d+):(\d+):(\d+),(\d+)\n(.+)',srt)
    if not cues: return False
    h,m,s,ms=map(int,cues[-1][:4])
    said=''.join(c[4] for c in cues).replace(' ','')
    return said==text.replace(' ','') and dur>=h*3600+m*60+s+ms/1000-.2
srt=tempfile.mktemp(suffix='.srt')
out=[]
for k,t in L:
    p=str(ROOT/f'public/voice/{k}.mp3')
    for attempt in range(5):
        r=subprocess.run([sys.executable,'-m','edge_tts','--voice',V,'--rate=+6%','--text',t,'--write-media',p,'--write-subtitles',srt],capture_output=True)
        if r.returncode==0:
            d=duration(p)
            if complete(t,open(srt,encoding='utf-8').read(),d): break
    else: sys.exit(f'{k}: no complete audio after 5 tries')
    out.append({'id':k,'text':t,'dur':round(d,3)})
json.dump(out,open(ROOT/'src/voice.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
print(sum(x['dur'] for x in out),[(x['id'],x['dur']) for x in out])
