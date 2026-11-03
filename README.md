<table><tr><td width="23%" align="center"><img src="web/assets/dot.png" width="180" alt="FinPilot 伙伴"></td><td width="77%"><img src="docs/assets/brand-title.svg" width="100%" alt="FinPilot：钱的事，我陪你。安全智能的个人财务伙伴"></td></tr></table>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.12%2B-3776AB?style=flat&logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/JavaScript-ES_Modules-F7DF1E?style=flat&logo=javascript&logoColor=white" alt="JavaScript">
  <img src="https://img.shields.io/badge/SQLite-Local_Data-003B57?style=flat&logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/WebGL-2-990000?style=flat&logo=webgl&logoColor=white" alt="WebGL">
  <img src="https://img.shields.io/badge/Web_Audio-Streaming-227A52?style=flat" alt="Web Audio">
</p>
![FinPilot 桌面演示页](docs/screenshots/showcase.jpg)

## 演示视频

https://github.com/user-attachments/assets/5593dc92-e263-473b-8478-9294c8524bc7

## 打开离线演示

[直接打开免配置体验](https://finpilot-judge-demo.pgr17398956318.chatgpt.site)。左侧选示例，填入右侧手机后发送，按卡片继续即可；无需模型 Key。

也可在本地运行：

需要 Python 3.12 或以上；主程序只用标准库，无需安装前端依赖。

```sh
git clone --branch 26fincom_v2 https://github.com/gr-peng/FinTechCompetition.git
cd FinTechCompetition
python -B server.py --port 65281
```

打开 [离线展示页](http://127.0.0.1:65281/showcase.html?session=offline-preview&offline=1#/bot)，点左侧示例填入，再点发送。后续在对话卡片中选择、核对和确认；每个场景前点左侧“重置演示”。离线密码卡会显示演示密码，无需模型 Key。

照着 [5个场景和15个常用问题](docs/DEMO-PROMPTS.zh-CN.md) 体验。离线支持预置示例和卡片操作；自由问答需切换在线模式并连接模型。

## FinPilot能做什么

- **安全换你安心** 自动识别交易和外部信息中的风险，根据风险程度选择确认、身份验证或暂停操作，让每一步资金往来都有保障。
- **有事主动提醒。** 关注账单、订阅和日程等重要事项，在合适的时间主动提醒，并在涉及操作时征得用户同意。
- **一句话安排多件事。** 理解生活中的复杂需求，协调多个步骤和服务，逐步完成安排，让用户随时了解进度并决定是否继续。
- **把模糊想法问清楚。** 通过简单对话了解用户的目标和偏好，结合财务情况，提供更贴合需求的预算、储蓄与理财建议。
- **文字与语音接续。** 支持文字和语音交互，用自然的对话方式提供回答、图表和操作卡片；即使没有连接语音服务，也能正常使用文字功能。


<table>
  <tr>
    <td align="center"><img src="docs/screenshots/today.jpg" width="200" alt="今天"><br>今天：工资到账</td>
    <td align="center"><img src="docs/screenshots/permission.png" width="200" alt="授权"><br>Bot：按任务授权</td>
    <td align="center"><img src="docs/screenshots/finance.png" width="200" alt="财务"><br>财务：分类图表</td>
    <td align="center"><img src="docs/screenshots/research.png" width="200" alt="研究"><br>投资：个股研究</td>
  </tr>
</table>

## 在线使用与开发

静态托管与导出见 [在线体验说明](docs/HOSTED-DEMO.md)。启动和模型连接见 [运行指南](RUNNING.md)。支持 Micu 与 MiniMax 官方对话，模型名可编辑；MiniMax 语音独立连接。凭据只留在服务内存，由用户自行填写。

```text
backend/          对话协议、提供方连接、会话与后端适配
baseline_backend/ 账户、持仓和行情数据模块
web/              App、桌面展示与前端资源
demo/             合成业务数据
config/           配置示例
tests/            自动化检查
tools/            启动验证与发布检查工具
docs/             演示流程和使用说明
server.py         本地启动入口
```



