"""Scripted planner replies for recording. Everything after the model call is the real app."""
import http.client, json, sys, runpy
from pathlib import Path
ROOT=str(Path(__file__).resolve().parents[2]); PORT=sys.argv[1] if len(sys.argv)>1 else '65295'; sys.path.insert(0,ROOT)
base=dict(cards=[],actions=[],query=None,missing=[],task_id=None,period_month=None,speak=None,context_action='new',fields={},mode='none')
tf=lambda a,**k:{'amount_minor':a,'payee_id':'mom','source_account':'salary_0826','scheduled_date':'2026-11-02','currency':'CNY',**k}
ask=lambda q,r:dict(status='answer',scenario='question',query=q,reply=r)
R=[
('周末我回家吃饭',dict(status='propose',scenario='compound',reply='短信、蛋糕和定金我拆成三步，请逐项核对。',fields={'items':[{'id':'item-1','kind':'sms','contact_id':'mom','message':'周末我回家吃饭'},{'id':'item-2','kind':'cake','product_id':'demo-cake-01','date':'2026-11-09','pickup_time':'16:00','fulfillment':'pickup','source_account':'living_1608'}]},cards=[{'type':'compound_plan'}],actions=[{'type':'prepare_compound'}],mode='create')),
('收到已保存房东',dict(status='answer',scenario='other',reply='房东发来11月房租提醒，金额和租约一致，11月3日到期。这次怎么安排？')),
('这次房租',dict(status='propose',scenario='rent_reminder',reply='已按租约整理好，请核对收款人和金额。',cards=[{'type':'rent_plan'}],actions=[{'type':'prepare_rent'}],mode='create')),
('吃饭花了',ask('dining_month','请看下方本月餐饮数据卡。')),
('每月花费趋势',ask('annual_trend','请看下方过去十二个月的趋势。')),
('安全账户',dict(status='blocked',scenario='risk_transfer',reply='“安全账户”是典型诈骗话术，银行不会让你转账保护资金。这笔不会发起。',fields={'amount_minor':1000000})),
('8891',dict(status='propose',scenario='security_case',reply='这个收款记录有 7 条举报，不能付款。',fields={'case_id':'reported_scam','recipient_name':'闲鱼卖家','recipient_reference':'reported-card-8891','amount_minor':200000,'source_account':'living_1608'},actions=[{'type':'show_security_case'}],mode='create')),
('11月云存储账单',dict(status='propose',scenario='security_case',reply='这封邮件索要验证码和密钥，可能是诈骗，别回复这些信息。',cards=[{'type':'security_notice'}],actions=[{'type':'show_security_case'}],fields={'case_id':'prompt_injection_email'},mode='create')),
('每月给妈妈',dict(status='propose',scenario='transfer',reply='定期转账已整理好，请核对每期金额和累计上限。',fields=tf(50000,cadence='monthly',occurrences=3),mode='create')),
]
class Resp:
    status=200
    def __init__(s,b): s.b=b
    def read(s,n=-1): return s.b
    def getheader(s,*a): return None
class Fake:
    sock=None
    def __init__(s,*a,**k): pass
    def request(s,m,p,body,h):
        msgs=json.loads(body)['messages']; u=[x for x in msgs if x['role']=='user'][-1]['content'].split('本轮用户输入：')[-1]
        o=next((v for k,v in R if k in u),dict(status='answer',scenario='other',reply='你好，有什么可以帮你？'))
        s.out=json.dumps({'model':'mock','choices':[{'finish_reason':'stop','message':{'content':json.dumps({**base,**o},ensure_ascii=False)}}]},ensure_ascii=False).encode()
    def getresponse(s): return Resp(s.out)
    def close(s): pass
http.client.HTTPSConnection=Fake
sys.argv=['server.py','--port',PORT,'--allow-api','--agent-validation']
runpy.run_path(ROOT+'/server.py',run_name='__main__')
