# FinPilot 宣传片

成片是 [`FinPilot.mp4`](FinPilot.mp4)，1 分 34 秒，1080p，带中文配音、字幕和背景音乐。整条片子都由这个目录里的代码生成，改文案或流程后可以重新出片。

| 部分 | 做法 | 文件 |
|---|---|---|
| 动画和剪辑 | [Remotion](https://www.remotion.dev/)，用 React 写视频 | `src/scenes.tsx`、`src/FinPilot.tsx` |
| App 录屏 | Playwright 自动操作真实 App，录下每一帧 | `tools/record.py` |
| 预设模型回复 | 替换对模型的网络请求，之后的校验、风控和界面都是真实程序 | `tools/mock_upstream.py` |
| 配音和字幕 | edge-tts 生成，每句时长决定画面时间轴 | `tools/voice.py`、`src/voice.json` |
| 音乐和音效 | numpy 合成 | `tools/music.py` |

录屏、配音和音乐都是生成物，不进 Git，按下面的步骤可以重新生成。

## 从头生成

需要 Node 20 以上、Python 3.12 以上、ffmpeg。配音要联网，其他步骤不用。以下命令都在 `video/` 目录下执行，在 macOS 上跑通过，其他系统需要换 `.venv/bin/` 这类路径写法。

录屏的是当前仓库里的 App，需要先合并定期转账（#5）等 PR，否则 `recurring` 这段录不出来。

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

开两个终端。第一个启动带预设回复的 FinPilot，端口是 65295，录完后按 Ctrl+C 停掉：

```sh
.venv/bin/python tools/mock_upstream.py
```

第二个开始录制，8 段大约 3 分钟，每段都会打印一行结果，`err=None` 表示这段正常：

```sh
.venv/bin/python tools/record.py
```

只重录一段就写上名字，比如 `.venv/bin/python tools/record.py inject`。

**4. 预览和渲染**

```sh
npm run studio
npm run render
```

`studio` 打开网页预览，可以拖时间轴。`render` 大约要 10 分钟，输出到 `out/FinPilot.mp4`，满意后覆盖这个目录下的 `FinPilot.mp4` 再提交。

## 想改点什么

- **改旁白：** 改 `tools/voice.py` 里的 `L`，重跑这个脚本，画面时间轴会自动跟着变。换声音改 `V`。
- **改动画：** 改 `src/scenes.tsx`。每段旁白结束后停留多久在 `src/timeline.ts` 的 `HOLD` 里。
- **改录屏流程：** `tools/record.py` 里每段是一个函数。新加的用户输入要在 `tools/mock_upstream.py` 的 `R` 里配一条预设回复，按用户输入里的关键词匹配。
- **对齐动画和录屏：** `tools/record.py` 会把点击时间写进 `src/marks.json`，`src/scenes.tsx` 里的提示动画据此定位，所以重录后不用手动对时间。

## 换成真实模型录屏

片子角标写着“模型输出为预设回放”，用真实模型重录之后才能去掉。下面的路径还没有用真实模型跑过，模型回复比预设慢，文案也会变，`tools/record.py` 里的等待时长和按钮文字可能要调。

1. 用真实模式启动 FinPilot（在仓库根目录执行）：

   ```sh
   python -u -B server.py --port 65295 --allow-api --agent-validation
   ```

2. 通过环境变量传 Key，别写进代码：

   ```sh
   FINPILOT_KEY=你的Key .venv/bin/python tools/record.py
   ```

   脚本默认连 Micu。用 MiniMax 官方的话，把 `tools/record.py` 里 `/api/config` 那段的 `provider`、`base_url`、`model` 换掉，取值见根目录的 `chat_profile.py`。

3. 删掉 `src/FinPilot.tsx` 里 Footnote 的“模型输出为预设回放”，再渲染。

## 常见问题

**渲染卡在 “Waiting for root component”：** 没接显示器的 Mac 上会遇到，Remotion 自带的 headless shell 不触发 `requestAnimationFrame`。改用 Playwright 的 chrome-headless-shell，路径里的版本号按本机实际填：

```sh
REMOTION_BROWSER=~/Library/Caches/ms-playwright/chromium_headless_shell-XXXX/chrome-headless-shell-mac-arm64/chrome-headless-shell npm run render
```

**录屏报 `ERR_CONNECTION_TIMED_OUT`：** 先确认第一个终端的 FinPilot 还在运行。刚下载的 Chromium 第一次启动时遇到过一次，重跑 `tools/record.py` 就好了。

**字体不一样：** 片子用的 PingFang SC 是 macOS 自带字体，其他系统会换成系统字体，排版可能略有变化。

## 素材说明

- App 里的账户、金额和人物都是合成数据。
- 配音用的 edge-tts 是微软在线语音的非官方调用方式。正式提交前请对照比赛的素材要求，要稳妥就换真人配音或有授权的语音服务。
- Remotion 对个人、3 人以内的公司和非营利组织免费，详见它的 [LICENSE](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)。
