# 运行指南

## 离线展示

Python 3.12 或以上，在仓库根目录运行：

```sh
python -B server.py --port 65281
```

打开 http://127.0.0.1:65281/showcase.html?session=offline-preview&offline=1#/bot 。主程序使用标准库，无需 npm 安装或构建。首次启动生成合成持仓数据库；重复启动保留已有数据。

每个场景前点击左侧“重置演示”。单独 App：`http://127.0.0.1:65281/?app=1&offline=1&session=offline-preview#/bot`。端口占用时改为 `--port 65300` 并同步修改地址。

## 在线对话与语音

```sh
python -u -B server.py --port 65281 --allow-api --agent-validation
```

打开 http://127.0.0.1:65281/showcase.html?session=demo#/bot ，在“我的 → 模型与连接”选择提供方、填写 Key 和模型名，保存本次连接。Micu 默认 `deepseek-flash`，MiniMax 官方默认 `MiniMax-M3.1-Flash`；凭据分别管理。[配置示例](config/API-CONFIG.example.json)。

MiniMax 语音独立连接和试听，仅发送待播报文本。麦克风识别由浏览器提供，首次使用需用户授权，可能依赖网络。文字与卡片不依赖语音连接。服务退出或会话过期后需重新连接，Key 不写入源码、URL、日志或浏览器本地存储。

可选本地语音入口 `voice_service.py` 需要安装 `requirements-voice-demo.txt` 并准备模型，详见 [语音说明](docs/VOICE-DEMO.md)。主演示无需启动它。

## 检查

Node.js 22.12 或以上用于前端测试：

```sh
node --test tests/*.test.mjs
python -B -m unittest discover -s tests -p "test_*.py"
python -B tools/check_release.py
```

在尚未启动过的新副本执行 `python -B tools/verify_clean_clone.py`，验证首次启动和资源路径。它使用随机空闲端口，只停止自己启动的服务。
