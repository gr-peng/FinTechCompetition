# 运行与演示

需要 Python 3.12，仅使用标准库；不需要 npm 安装或前端构建。

```sh
python -B server.py
```

首次启动自动创建 4 项合成持仓，已有数据库保持不变。打开 http://127.0.0.1:65281/：900px 及以上的顶层窗口进入桌面展示，窄窗口直接进入原 App。同源 iframe 和 `?app=1` 始终保留 App，不会反复跳回展示页。

- 桌面展示：`http://127.0.0.1:65281/?session=demo#/today`
- 单独 App：`http://127.0.0.1:65281/?app=1&session=demo#/today`
- 关闭材质作对照：在对应入口添加 `material=off`，展示页会保留该参数。
- 换端口：`python -B server.py --port 65300`，URL 中端口同步修改，不要关闭不明进程。

## 可选模型连接

```sh
python -u -B server.py --port 65281 --allow-api --agent-validation
```

由用户在“我的 → 模型与连接”提交本次连接。默认不调用模型，未配置会明确提示。密钥只存服务 RAM，进程退出或连接过期后失效；不写入仓库、URL、日志或 localStorage。

当前版本支持 MiniMax 官方与 Micu 对话连接，各自保留模型名与独立凭据。模型名可编辑，去除首尾空白后不得为空；点击“保存本次连接”才生效。MiniMax 官方默认 `MiniMax-M3.1-Flash`，Micu 沿用项目默认模型，端点不会因模型名称改变。语音单独连接 MiniMax，不复用对话 Key。新克隆首次启动即加载当前协议，无需先发送消息。

## 演示与常见问题

展示页五步导航驱动同源 App，并跟随 App 当前路由高亮；手机框按宽高缩放。reset 只清当前 session 的演示状态，保留其他 session、API Cookie 与既有数据库。不同评委或排练使用不同 `session=`。

启动已使用 128 的监听 backlog 处理 ES modules/CSS 的并发加载。首次数据库初始化由启动统一完成。诊断参数只用于测试，正常演示不用 `material-audit` 或 `material-fail`。

```sh
node --test tests/*.test.mjs
python -B -m unittest discover -s tests -p "test_*.py"
python -B tools/check_release.py
```

在尚未初始化的新克隆里运行 `python -B tools/verify_clean_clone.py`，验证一条命令首次启动、重复初始化保留数据库及核心资源。测试使用随机空闲端口，只停止自己的进程，不影响已运行服务。

## 模型连接排错

“保存本次连接”只保存到当前本地服务的 RAM，不表示上游模型已验证成功。未开启模型模式时表单禁止填写密钥，并明确提示服务状态。只开 --allow-api 而未开 --agent-validation，也不足以启用规划器；请使用上面的完整模型模式命令。

iframe 与独立 App 使用同源的 /api/session、/api/config、/api/agent，不经展示页转发密钥。session= 区分前端演示状态；API 会话 Cookie 按服务端口隔离，防止多个本地预览互相替换 Cookie。保存前会刷新会话/CSRF，不重放资金操作或自动重试模型请求。

不同端口的服务不共享内存中的连接。服务重启后请重新填写 Key，不要写入 .env。

## 当前主动委托演示

```powershell
python -u -B server.py --port 65281 --allow-api --agent-validation
```

展示入口 `http://127.0.0.1:65281/showcase.html?session=judge-morning#/bot`；直开 `http://127.0.0.1:65281/?session=judge-morning&app=1#/bot`。普通页面不放场景列表、测试控制台或语音选项；提示词及固定事件命令见 [五场景脚本](docs/DEMO-PROMPTS.zh-CN.md)。长线记录在原有“任务”页，实际核对在对话内。

当前默认语音为MiniMax中国站，用户在“我的 → 模型与连接 → 语音 MiniMax”自行填写Key并点击试听；见[语音连接说明](docs/MINIMAX-SETTINGS.md)。失败不自动回退。以下Kokoro1.1 FP32、zf_001是保留的历史本地方案，不是当前默认。独立仅回环65323侧车启动与许可见 [女声升级](docs/VOICE-FEMALE-UPGRADE.md)。设置你本机已有的语音环境及模型目录后：

```powershell
& $VoicePython -u -B voice_service.py --engine kokoro --precision fp32 --model-dir $VoiceModelDir --speaker 3 --threads 8 --speed 1.0 --port 65323
```

主服务同源代理该侧车。首次麦克风必须用户点击并授予浏览器权限，识别可能依赖浏览器网络；不能宣称完全离线双向语音。只有输入框右侧一个麦克风，停止后文字回填供核对发送。侧车或麦克风失败时保留文字输入。

模型连接仅存当前主服务RAM，一小时或重启后需要重新填写自己的现有连接；不改写.env或持久密钥。未连接时不会用预置整段回复冒充实时模型。

完整回归：`node --test tests/*.test.mjs`；`python -B -m unittest discover -s tests -p "test_*.py"`。实际passed/notrun见 [验收说明](docs/COMPANION-ACCEPTANCE.md)。
