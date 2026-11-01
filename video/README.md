# FinPilot 演示视频

成片是 [`FinPilot.mp4`](FinPilot.mp4)，不到 5 分钟，1080p，带中文配音、字幕和背景音乐。内容按 [`docs/DEMO-PROMPTS.zh-CN.md`](../docs/DEMO-PROMPTS.zh-CN.md) 的五个场景走一遍，并介绍今天页和投资页。整条片子都由这个目录里的代码生成，改文案或流程后可以重新出片。

| 部分 | 做法 | 文件 |
|---|---|---|
| 动画和剪辑 | [Remotion](https://www.remotion.dev/)，用 React 写视频 | `src/chapter.tsx`、`src/scenes.tsx`、`src/FinPilot.tsx` |
| 每句旁白配哪段录屏 | 场景、步骤和侧栏文字 | `src/script.ts` |
| App 录屏 | Playwright 自动操作 App 的离线展示模式，录下每一帧 | `tools/record.py` |
| 配音和字幕 | edge-tts 生成，每句时长决定画面时间轴 | `tools/voice.py`、`src/voice.json` |
| 音乐和音效 | numpy 合成 | `tools/music.py` |

录屏用的是 App 自带的离线展示（网址加 `offline=1`）：自然语言理解换成预置解析，校验、风控、确认和密码验证都走正常流程，也不需要模型 Key。`tools/record.py` 在录屏时隐藏离线模式才有的密码提示，并去掉“演示密码”“虚构研究产品”这类字样，App 本身不变。

录屏、配音和音乐都是生成物，不进 Git，按下面的步骤可以重新生成。

## 从头生成

需要 Node 20 以上、Python 3.12 以上、ffmpeg。配音要联网，其他步骤不用。以下命令都在 `video/` 目录下执行，在 macOS 上跑通过，其他系统需要换 `.venv/bin/` 这类路径写法。

**1. 安装依赖**

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install edge-tts numpy playwright
.venv/bin/playwright install chromium
```

**2. 生成配音和音乐**

```sh
.venv/bin/python tools/voice.py
.venv/bin/python tools/music.py
```

**3. 录屏**

开两个终端。第一个在仓库根目录启动 FinPilot，端口是 65295，录完后按 Ctrl+C 停掉：

```sh
python3 -B server.py --port 65295
```

第二个回到 `video/` 目录开始录制。13 段大约 7 分钟，每段都会打印一行结果，`err=None` 表示这段正常：

```sh
.venv/bin/python tools/record.py
```

只重录一段就写上名字，比如 `.venv/bin/python tools/record.py s2_mail`。

**4. 预览和渲染**

```sh
npm run studio
npm run render
```

`studio` 打开网页预览，可以拖时间轴。`render` 输出到 `out/FinPilot.mp4`，满意后覆盖这个目录下的 `FinPilot.mp4` 再提交。

## 想改点什么

- **改旁白：** 改 `tools/voice.py` 里的 `L`，然后重跑 `voice.py` 和 `record.py`。录屏会按每句旁白的时长等待，所以画面和解说是对齐的。换声音改 `V`。
- **改侧栏文字：** 改 `src/script.ts`。
- **改录屏流程：** `tools/record.py` 里每段是一个函数。`c.beat('c1a')` 表示这句旁白从这里开始，后面写这句话期间要做的操作。`c.tap(文字, read=毫秒)` 的 `read` 是点击前让卡片停留的时间，觉得点得太快就调大。动作超出旁白时长时，这句后面的画面会继续播完，不会加速。
- **加一句旁白：** 在 `tools/voice.py`、`src/script.ts` 和 `tools/record.py` 里用同一个 id 各加一处。
- **改动画：** 片头、架构图和片尾在 `src/scenes.tsx`，场景版式在 `src/chapter.tsx`，每句旁白后的停顿在 `src/timeline.ts`。

## 常见问题

**渲染卡在 “Waiting for root component”：** 没接显示器的 Mac 上会遇到，Remotion 自带的 headless shell 不触发 `requestAnimationFrame`。改用 Playwright 的 chrome-headless-shell，路径里的版本号按本机实际填：

```sh
REMOTION_BROWSER=~/Library/Caches/ms-playwright/chromium_headless_shell-XXXX/chrome-headless-shell-mac-arm64/chrome-headless-shell npm run render
```

**录屏报 `ERR_CONNECTION_TIMED_OUT`：** 先确认第一个终端的 FinPilot 还在运行。刚下载的 Chromium 第一次启动时遇到过一次，重跑 `tools/record.py` 就好了。

**字体不一样：** 片子用的 PingFang SC 是 macOS 自带字体，其他系统会换成系统字体，排版可能略有变化。

## 素材说明

- App 里的账户、金额和人物都是合成数据，不发真实短信，也不叫车。
- 配音用的 edge-tts 是微软在线语音的非官方调用方式。正式提交前请对照比赛的素材要求，要稳妥就换真人配音或有授权的语音服务。
- Remotion 对个人、3 人以内的公司和非营利组织免费，详见它的 [LICENSE](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)。
