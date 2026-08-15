# DeepSeek Harness for VS Code

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Agent Web UI 嵌入 VS Code —— 不用离开编辑器就能驱动 DeepSeek Agent 会话。

Embed the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agent web UI inside VS Code — drive DeepSeek agent sessions without leaving your editor.

![DeepSeek Harness](media/icon.png)

## Features / 功能

- **Webview 面板**：以 iframe 形式在 VS Code 侧边面板中嵌入 `dsh web` 的完整界面（会话、工具调用、Agent 循环、插件 UI 全部可用）。
  **Webview panel**: the full `dsh web` UI (sessions, tool calls, agent loop, plugin UIs) embedded as an iframe in a VS Code panel.
- **自动探测与启动**：打开面板时自动探测服务器；未运行时按配置的命令（默认 `dsh web`）拉起进程并轮询直到就绪。
  **Auto-detect & auto-start**: probes the server URL when the panel opens, and spawns the configured command (default `dsh web`) when it is missing, polling until it is ready.
- **状态栏**：`DSH Online / Offline / Starting` 一目了然，点击直接打开面板。
  **Status bar**: live `DSH Online / Offline / Starting` indicator; click to open the panel.
- **当前文件感知（Claude Code 式）**：你在 VS Code 中正在查看/编辑的文件会实时推送给 DSH；Agent 会话通过 `vscode_active_file` 工具随时读取它（路径、语言、选区、未保存标记、内容），系统提示每轮注入 `[VS Code] Active file: ...`。
  **Active-file awareness (Claude Code style)**: the file you are viewing/editing is pushed to the harness in real time; agent sessions read it anytime via the `vscode_active_file` tool (path, language, selection, dirty flag, content), with a `[VS Code] Active file: ...` line injected into the system prompt every turn.
- **浏览器备用**：一键在系统浏览器中打开同一界面。
  **Browser fallback**: open the same UI in your system browser with one command.
- **可配置**：URL、启动命令、超时、开机自动打开均可设置，支持远程部署（需配合 `--trusted-host`）。
  **Configurable**: URL, start command, timeouts, auto-open; remote deployments supported via `dsh web --trusted-host`.

## Requirements / 环境要求

- VS Code ≥ 1.80
- 可用的 DeepSeek Harness CLI，且 `dsh web` 能启动 Web 服务器（`dshHarness.startCommand` 可自定义）。
  安装方式任选其一：从 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 仓库 `pnpm install` 后使用仓库内 `pnpm dsh`（或全局安装 CLI），确保 `dsh` 在 PATH 中。

- VS Code ≥ 1.80
- A DeepSeek Harness CLI whose `dsh web` can serve the browser UI (customizable via `dshHarness.startCommand`). Install it from the [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) repo (`pnpm install`, then use the repo's `pnpm dsh` / a global CLI shim) and make sure `dsh` is on your PATH.

## Quick Start / 快速开始

1. 安装扩展（`Install from VSIX...` 选择打包产物，或从 GitHub Releases 下载）。
   Install the extension (`Install from VSIX...` with the packaged `.vsix`, or grab it from GitHub Releases).
2. 命令面板执行 **`DeepSeek Harness: Open Panel`**。
   Run **`DeepSeek Harness: Open Panel`** from the command palette.
3. 若服务器未运行且 `dshHarness.autoStart` 开启，扩展会自动启动并等待就绪，然后载入界面。
   If the server is not running and `dshHarness.autoStart` is on, the extension starts it and loads the UI once it is ready.

## Commands / 命令

| Command | Description / 说明 |
| --- | --- |
| `DeepSeek Harness: Open Panel` | Open the embedded panel / 打开嵌入面板 |
| `DeepSeek Harness: Open in Browser` | Open the UI in the system browser / 在浏览器中打开 |
| `DeepSeek Harness: Start Server` | Start the server if it is not running / 启动服务器 |
| `DeepSeek Harness: Stop Server` | Stop the spawned server process / 停止服务器 |
| `DeepSeek Harness: Reload Panel` | Reload the embedded page / 重新加载面板 |
| `DeepSeek Harness: Report Active File` | Push the current editor to the harness immediately / 立即上报当前文件 |

## Settings / 设置

| Key | Default | Description / 说明 |
| --- | --- | --- |
| `dshHarness.url` | `http://127.0.0.1:3080` | Web 服务器地址。DSH 的 `/api` 信任围栏默认只接受回环地址；远程访问需用 `dsh web --trusted-host <host>` 并在设置中填写对应 URL。 |
| `dshHarness.autoStart` | `true` | 服务器不可达时是否自动启动。 |
| `dshHarness.startCommand` | `dsh web` | 启动命令，例如 `dsh web` 或 `dsh --profile web --port 8080`。 |
| `dshHarness.startTimeoutSec` | `120` | 启动后等待就绪的秒数。 |
| `dshHarness.openOnStartup` | `false` | VS Code 启动时自动打开面板。 |
| `dshHarness.probeTimeoutMs` | `2500` | 单次健康探测的超时（毫秒）。 |
| `dshHarness.trackActiveFile` | `true` | 是否把当前活动文件推送给 DSH（需要 harness 侧安装 dsh-vscode-bridge 插件）。 |

## Active-File Awareness / 当前文件感知

让 Agent 像 Claude Code 一样知道你正在编辑哪个文件，需要**两侧**配合：

1. 本扩展持续跟踪活动编辑器（切换文件、编辑内容都会触发，350ms 防抖），把快照推送到 DSH 的 `/vscode/active-file` 端点。
2. DSH 侧安装仓库内 [`dsh-plugin/`](dsh-plugin/)（`dsh-vscode-bridge`）插件：
   ```bash
   cd dsh-plugin
   DSH_CHECKOUT=<deepseek-harness 检出路径> bash scripts/build.sh
   npm pack                       # 得到 dsh-vscode-bridge-0.1.0.tgz
   # 在 harness 中安装该 tgz（bundle 装配），或使用 dsh-super-injector 热装配：
   # dev_install_package {"dir": "<dsh-plugin 绝对路径>"}
   ```
   插件注册 `vscode_active_file` 工具 + `[VS Code] Active file: ...` 系统提示节（每轮求值）。新建会话即可生效。

验证：在 VS Code 打开任意文件后，`curl http://127.0.0.1:3080/vscode/active-file` 应返回该文件的快照 JSON。

The two halves work together: this extension tracks the active editor and pushes snapshots to `/vscode/active-file`; the harness-side plugin in [`dsh-plugin/`](dsh-plugin/) (`dsh-vscode-bridge`) exposes them as the `vscode_active_file` tool plus a per-turn `[VS Code] Active file: ...` prompt section. Install the plugin (build + `npm pack`, then bundle/install it in your harness), open a file in VS Code, and `curl http://127.0.0.1:3080/vscode/active-file` should return its snapshot.

## How It Works / 工作原理

- DeepSeek Harness 的 Web 架构是「localhost HTTP 服务器 + 静态前端 + `/api` RPC + WebSocket 事件流（`/api/events.mux`）」，回环地址默认受信。
  DeepSeek Harness serves a static SPA plus `/api` RPC and a WebSocket event stream (`/api/events.mux`); loopback is trusted by default.
- 本扩展不重新实现客户端协议：Webview 内 iframe 直接加载服务器页面（同源请求全部走回环，天然通过信任围栏），因此会话、工具、插件 UI 与浏览器中完全一致。
  This extension does not re-implement the client protocol: the webview iframe loads the page directly from the server, so all requests are same-origin loopback and pass the trust fence — sessions, tools and plugin UIs behave exactly as in a browser.
- 安全：面板内不注入任何远程脚本，CSP 仅放行 iframe 帧与面板自身的内联脚本。
  Security: no remote scripts are injected; the panel CSP only permits the iframe and its own inline script.

## Development / 开发

```bash
npm install
npm run compile     # tsc build
npm run smoke       # compile + probe/spawn/poll/stop smoke tests (pure Node)
npm run package     # produce the .vsix
```

`npm run smoke` 会对真实运行的 DSH 服务器（默认 `http://127.0.0.1:3080`）做健康探测，并用一个临时 HTTP 服务完整演练「启动 → 轮询 → 停止」管线。

## License

MIT
