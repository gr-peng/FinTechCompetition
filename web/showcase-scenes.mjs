// Fixed replays for judges without a model key. Exact text only: planner output is scripted,
// everything after it (risk policy, cards, confirmation, ledger) is the real local code.
export const SCENES=[
 {
  "id": "normal",
  "label": "正常转账",
  "hint": "低风险，确认后执行",
  "text": "今天从工资账户0826给妈妈转500元",
  "verdict": "ok",
  "result": {
   "speak": null,
   "cards": [],
   "actions": [],
   "query": null,
   "missing": [],
   "task_id": null,
   "period_month": null,
   "context_action": "new",
   "status": "propose",
   "scenario": "transfer",
   "reply": "已整理好转账方案，请在下方核对。",
   "fields": {
    "amount_minor": 50000,
    "payee_id": "mom",
    "source_account": "salary_0826",
    "scheduled_date": "2026-11-02",
    "currency": "CNY"
   },
   "mode": "create"
  },
  "steps": [
   [
    "理解意图",
    "转账 · 妈妈 · ¥500 · 工资账户 0826"
   ],
   [
    "核对本地资料",
    "已知联系人，尾号 6821；扣除后仍保留 ¥8,000 必要支出"
   ],
   [
    "风险分级",
    "低风险：今日累计未超过 ¥1,000"
   ],
   [
    "等你点头",
    "模型无权动钱，确认后由本地程序执行"
   ]
  ]
 },
 {
  "id": "new",
  "label": "首次收款人",
  "hint": "中风险，要密码",
  "text": "给陈宇转800元",
  "verdict": "warn",
  "result": {
   "speak": null,
   "cards": [],
   "actions": [
    {
     "type": "show_security_case"
    }
   ],
   "query": null,
   "missing": [],
   "task_id": null,
   "period_month": null,
   "context_action": "new",
   "status": "propose",
   "scenario": "security_case",
   "reply": "陈宇是首次收款，请核对对象和金额。",
   "fields": {
    "case_id": "unfamiliar_recipient",
    "recipient_name": "陈宇",
    "recipient_reference": "new-card-6217",
    "amount_minor": 80000,
    "source_account": "living_1608"
   },
   "mode": "create"
  },
  "steps": [
   [
    "理解意图",
    "转账 · 陈宇 · ¥800"
   ],
   [
    "核对本地资料",
    "通讯录匹配尾号 6217，无举报，首次收款"
   ],
   [
    "风险分级",
    "中风险：新收款人"
   ],
   [
    "加强验证",
    "确认后还要输入演示密码 123456"
   ]
  ]
 },
 {
  "id": "scam",
  "label": "诈骗话术",
  "hint": "直接拦截",
  "text": "有人说我的账户有风险，让我马上把10000元转到他发来的安全账户",
  "verdict": "block",
  "result": {
   "speak": null,
   "cards": [],
   "actions": [],
   "query": null,
   "missing": [],
   "task_id": null,
   "period_month": null,
   "context_action": "new",
   "status": "blocked",
   "scenario": "risk_transfer",
   "reply": "“安全账户”是典型诈骗话术，银行不会要求你转账保护资金。这笔不会发起。",
   "fields": {
    "amount_minor": 1000000
   },
   "mode": "none"
  },
  "steps": [
   [
    "理解意图",
    "转账 · 未知收款人 · ¥10,000"
   ],
   [
    "识别话术",
    "“账户有风险”“安全账户”“马上转”"
   ],
   [
    "风险分级",
    "高危：收款人未核实"
   ],
   [
    "已拦截",
    "没有授权入口，密码也不能放行"
   ]
  ]
 },
 {
  "id": "reported",
  "label": "被举报账户",
  "hint": "触发熔断",
  "text": "给闲鱼卖家卡号尾号8891转2000元",
  "verdict": "block",
  "result": {
   "speak": null,
   "cards": [],
   "actions": [
    {
     "type": "show_security_case"
    }
   ],
   "query": null,
   "missing": [],
   "task_id": null,
   "period_month": null,
   "context_action": "new",
   "status": "propose",
   "scenario": "security_case",
   "reply": "这个收款记录有 7 条举报，不能付款。",
   "fields": {
    "case_id": "reported_scam",
    "recipient_name": "闲鱼卖家",
    "recipient_reference": "reported-card-8891",
    "amount_minor": 200000,
    "source_account": "living_1608"
   },
   "mode": "create"
  },
  "steps": [
   [
    "理解意图",
    "转账 · 闲鱼卖家 · ¥2,000"
   ],
   [
    "核对本地资料",
    "合成风险名册：尾号 8891，7 条举报"
   ],
   [
    "风险分级",
    "高危：多人举报"
   ],
   [
    "已拦截",
    "恢复权限也不能放行这位收款人"
   ]
  ]
 },
 {
  "id": "compound",
  "label": "一句话办多件事",
  "hint": "逐步确认",
  "text": "给妈妈发短信：周末我回家吃饭。另外帮我预订11月9日下午4点自取的六寸草莓蛋糕，用生活账户1608付定金。",
  "verdict": "ok",
  "result": {
   "speak": null,
   "cards": [
    {
     "type": "compound_plan"
    }
   ],
   "actions": [
    {
     "type": "prepare_compound"
    }
   ],
   "query": null,
   "missing": [],
   "task_id": null,
   "period_month": null,
   "context_action": "new",
   "status": "propose",
   "scenario": "compound",
   "reply": "短信、蛋糕和定金我拆成了三步，请逐项核对。",
   "fields": {
    "items": [
     {
      "id": "item-1",
      "kind": "sms",
      "contact_id": "mom",
      "message": "周末我回家吃饭"
     },
     {
      "id": "item-2",
      "kind": "cake",
      "product_id": "demo-cake-01",
      "date": "2026-11-09",
      "pickup_time": "16:00",
      "fulfillment": "pickup",
      "source_account": "living_1608"
     }
    ]
   },
   "mode": "create"
  },
  "steps": [
   [
    "理解意图",
    "一句话里有发短信、订蛋糕、付定金"
   ],
   [
    "任务规划",
    "拆成 3 步，后一步依赖前一步"
   ],
   [
    "风险分级",
    "每个写操作单独判断"
   ],
   [
    "逐步确认",
    "每一步都要你点头，任何一步都能取消"
   ]
  ]
 }
];
