# Specula iOS

将 [Specula](../Specula)（Electron + React AI 阅读器）迁移为 Capacitor iOS 应用。

## 功能

- 导入 EPUB / PDF 电子书
- EPUB 章节阅读、PDF 分页阅读
- 文本选中 / 图片点击 AI 解释（11 种教学模式）
- 章节测验、评分、薄弱点分析
- 划线笔记与阅读进度同步
- 深色模式、多 LLM 提供商配置

## 技术栈

- React 18 + Vite 6 + Tailwind CSS
- Capacitor 7（Filesystem、Preferences）
- sql.js（本地 SQLite）
- OpenAI 兼容 API

## 开发

```bash
cd Specula-ios
npm install
npm run dev          # 浏览器预览
npm run build        # 构建 Web 资源
npm run cap:sync     # 构建并同步到 iOS 工程
npm run cap:open     # 在 Xcode 中打开（需 macOS）
```

> iOS 原生工程需在 **macOS + Xcode** 上执行 `npx cap add ios`（首次）和 `npx cap sync ios`。

## 架构说明

Electron 版的 `electron/` 主进程逻辑已迁移到 `src/services/`：

| 原 Electron 模块 | iOS 替代 |
|---|---|
| `electron/main.ts` + IPC | `src/services/specula.ts` 直接调用 |
| `fs` + `dialog` | `@capacitor/filesystem` + 文件选择器 |
| `electron-store` | `@capacitor/preferences` |
| `sql.js`（main 进程） | `src/services/db.ts`（Web 层 + Filesystem 持久化） |
| `webContents.send` 流式推送 | `src/services/streamEvents.ts` |

React UI 层（`src/pages/`、`src/components/`）基本保持原样，仍通过 `window.specula` 访问 API。

## iOS 适配

- 安全区（`safe-area-inset`）
- 底部 Tab 导航（手机端）
- 阅读器侧栏改为浮层抽屉
- 触控友好按钮尺寸（44px 最小高度）
- 删除按钮在触屏设备上始终可见

## 数据存储

应用沙盒 `Directory.Data` 下：

- `specula.db` — 书籍元数据、章节、笔记、测验
- `books/` — 电子书文件
- `covers/` — 封面图片

设置通过 Capacitor Preferences 存储。

## TestFlight builtin credentials

For TestFlight builds, copy `env.testflight.example` to `.env.local` and fill:

```bash
VITE_SPECULA_TEXT_API_KEY=...
VITE_SPECULA_VISION_API_KEY=...
```

Then build and sync:

```bash
npm run build
npx cap sync ios
```

The keys are not shown in the app settings UI. They are still bundled into the IPA, so this is suitable for controlled TestFlight testing only. For public release, move model calls behind a backend proxy.

The app also bundles one original, redistributable EPUB sample:

```text
public/sample-books/Specula_Getting_Started.epub
```
