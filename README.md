# X GIF 下载器

一个用于 Chrome、Edge 等 Chromium 浏览器的扩展。安装后，它会在 X（Twitter）里的 GIF 动图右上角增加“下载 GIF”按钮，并将文件转换为真正的 `.gif` 格式。

> X 上的 GIF 实际以循环播放的 MP4 文件提供。扩展会在浏览器内完成 MP4 → GIF 转换，因此点击后需要等待几秒。GIF 通常比原始 MP4 更大。

## 安装

1. 打开浏览器的扩展管理页面：
   - Chrome：`chrome://extensions`
   - Edge：`edge://extensions`
2. 打开右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目文件夹。
5. 刷新已经打开的 `x.com` 或 `twitter.com` 标签页。

## 使用

1. 打开或刷新 `https://x.com`。
2. 找到一条带 GIF 动图的推文。
3. 点击动图右上角的“下载 GIF”按钮。
4. 等待按钮显示“GIF 已下载”。文件会保存到浏览器的默认下载目录。

扩展也支持旧域名 `https://twitter.com`，并会监听滚动后动态加载的新推文。

## 看不到按钮

1. 在扩展管理页面确认已加载版本 `1.1.1`。
2. 加载或更新扩展后，刷新已经打开的 X 标签页。
3. 确认选择的是直接包含 `manifest.json` 的解压目录，而不是压缩包本身。
4. 下载按钮会显示在 GIF 播放区域右上角。普通视频不会显示按钮。

## 文件说明

- `manifest.json`：扩展配置。
- `content.js`：识别 GIF 动图并添加下载按钮。
- `background.js`：协调 GIF 转换并使用浏览器下载 API 保存文件。
- `offscreen.html`、`offscreen.js`：在隐藏页面中执行 MP4 → GIF 转换。
- `styles.css`：下载按钮样式。
- `vendor/ffmpeg/`：随扩展离线提供的 `ffmpeg.wasm` 转换器。
- `tests/fixture.html`：本地验证页面。

## 转换策略

为了控制文件体积，导出的 GIF 最长边不会超过 640 像素，帧率为 12 FPS，调色板最多使用 128 种颜色。

## 第三方组件

扩展内置：

- `@ffmpeg/ffmpeg` 0.12.15，MIT License。
- `@ffmpeg/core` 0.12.10，GPL-2.0-or-later。

## 本地验证

在项目目录运行：

```powershell
python -m http.server 8765
```

然后打开：

- `http://localhost:8765/tests/fixture.html`：验证 GIF 按钮、普通视频过滤和动态加载。
- `http://localhost:8765/tests/converter-fixture.html`：运行一次真实的 MP4 → GIF 转换并验证 GIF 文件签名。

转换测试使用 `ffmpegwasm/testdata` 仓库中的 `video-1s.mp4`。
