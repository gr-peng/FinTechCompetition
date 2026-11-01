// Which clip plays under each narration line, and what the side panel says about it.
export type Beat = {id: string; clip: string; title: string; detail: string; risk?: boolean; stamp?: string};
export type Chapter = {id: string; label: string; title: string; tag: string; beats: Beat[]};

export const CHAPTERS: Chapter[] = [
  {id: 'c0', label: '今天页', title: '打开 App，先看今天', tag: '工资 · 房租 · 预算 · 余额', beats: [
    {id: 't1', clip: 'today', title: '要紧的事放在一起', detail: '工资到账、房租、旅行预算、账户余额'},
    {id: 't2', clip: 'today', title: '工资整理成任务卡', detail: '收款人、金额、必要支出预留'},
  ]},
  {id: 'c1', label: '场景一', title: '给新收款人转账', tag: '智能转账 · 权限分级', beats: [
    {id: 'c1a', clip: 's1_new', title: '一句话发起', detail: '陈宇 ¥300，完整卡号'},
    {id: 'c1b', clip: 's1_new', title: '先查转账记录', detail: '首次向这张卡转账 · 中风险'},
    {id: 'c1c', clip: 's1_new', title: '确认并验证身份', detail: '密码正确才转出'},
    {id: 'c1d', clip: 's1_lock', title: '连续输错三次', detail: '冻结 10 分钟，钱没有转出', risk: true, stamp: '已冻结'},
    {id: 'c1e', clip: 's1_bad', title: '被多人标记的收款人', detail: '停止转账，验证也不能放行', risk: true, stamp: '已停止'},
  ]},
  {id: 'c2', label: '场景二', title: '收到账单邮件', tag: '注入防御 · 幻觉防护', beats: [
    {id: 'c2a', clip: 's2_mail', title: '先给摘要', detail: '云存储 ¥25，11月28日到期'},
    {id: 'c2b', clip: 's2_mail', title: '标出可疑要求', detail: '索要验证码和 API 密钥', risk: true},
    {id: 'c2c', clip: 's2_mail', title: '验证身份不等于授权', detail: '验证后仍提示可能是诈骗', risk: true},
    {id: 'c2d', clip: 's2_mail', title: '放弃处理', detail: '邮件未回复，信息未发送', risk: true, stamp: '未发送'},
  ]},
  {id: 'c3', label: '场景三', title: '房租与会员主动提醒', tag: '订阅管理 · 主动提醒', beats: [
    {id: 'c3a', clip: 's3_rent', title: '房东邮件到了', detail: '¥3,500，11月3日前处理'},
    {id: 'c3b', clip: 's3_rent', title: '确认并验证后付款', detail: '未确认不付款'},
    {id: 'c3c', clip: 's3_sub', title: '会员即将到期', detail: '云音乐，每月28日续费 ¥25'},
    {id: 'c3d', clip: 's3_sub', title: '只续本期', detail: '只处理本期 ¥25'},
    {id: 'c3e', clip: 's3_sub2', title: '取消下次续费', detail: '保留本期权益，不退款'},
  ]},
  {id: 'c4', label: '场景四', title: '告诉妈妈、约车回家、提醒出发', tag: '跨场景联动 · 任务规划', beats: [
    {id: 'c4a', clip: 's4_ride', title: '一句话三件事', detail: '短信、顺风车、出发提醒'},
    {id: 'c4b', clip: 's4_ride', title: '逐项补齐', detail: '时间、地点、车费上限'},
    {id: 'c4c', clip: 's4_ride', title: '短信确认后才发', detail: '内容和号码先核对'},
    {id: 'c4d', clip: 's4_ride', title: '预约单独确认', detail: '11月7日 09:00，上限 ¥80，不扣车费'},
    {id: 'c4e', clip: 's4_ride', title: '结果一目了然', detail: '车费未支付，提醒已设定'},
    {id: 'c4f', clip: 's4_ride', title: '到点主动提醒', detail: '还有一小时出发'},
  ]},
  {id: 'c5', label: '场景五', title: '手里有点钱，先找到方向', tag: '理财操作 · 意图理解', beats: [
    {id: 'c5a', clip: 's5_wealth', title: '先问方向', detail: '不急着推荐产品'},
    {id: 'c5b', clip: 's5_wealth', title: '算清可安排的钱', detail: '现金、生活预算、备用金'},
    {id: 'c5c', clip: 's5_wealth', title: '先留出要用的钱', detail: '旅行 ¥5,000 · 半年不用'},
    {id: 'c5d', clip: 's5_wealth', title: '三道风险问答', detail: '投资经验、本金波动、收入和备用金'},
    {id: 'c5e', clip: 's5_wealth', title: '比较两款产品', detail: '费用、赎回时间、资料日期'},
    {id: 'c5f', clip: 's5_wealth', title: '确认并验证', detail: '清泉灵活 ¥3,000，已买入'},
    {id: 'c5g', clip: 's5_wealth', title: '投资页同步', detail: '理财持仓 ¥3,000，可用余额 ¥47,000'},
  ]},
  {id: 'c6', label: '场景五', title: '换条路线：为目标存钱', tag: '理财操作 · 意图理解', beats: [
    {id: 'c5h', clip: 's5_save', title: '定目标和节奏', detail: '旅行 ¥600，每天 ¥20'},
    {id: 'c5i', clip: 's5_save', title: '同一个储蓄罐', detail: '财务 → 图表 → 预算'},
  ]},
  {id: 'c7', label: '投资页', title: '持仓、理财和研究都在这里', tag: '个人持仓 · 银行理财 · 投资研究', beats: [
    {id: 'i1', clip: 'invest', title: '持仓和风险分析', detail: '成本、市值、盈亏，12 个月收支记录'},
    {id: 'i2', clip: 'invest', title: '理财和行情', detail: '申购赎回、历史行情'},
  ]},
];

export const RISK_BEATS = new Set(CHAPTERS.flatMap((c) => c.beats.filter((b) => b.risk).map((b) => b.id)));
