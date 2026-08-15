# dsh-vscode-bridge

DSH 侧插件：让 DeepSeek Harness 的 Agent 会话感知你正在 VS Code 里编辑的文件（Claude Code 式上下文）。
The harness-side plugin that gives agent sessions "Claude Code style" awareness of the file you are editing in VS Code.

配合 VS Code 扩展 [`deepseek-harness-vscode`](https://github.com/Cdown1/deepseek-harness-vscode)（`dshHarness.trackActiveFile`）使用。

## 功能 / What it does

1. VS Code 扩展在切换/编辑文件时，把活动编辑器快照（路径、语言、选区、未保存标记、≤96 KiB 内容）POST 到本插件的 `/vscode/active-file` 端点。
2. 插件缓存最新快照，并注册模型工具 **`vscode_active_file`** —— Agent 随时可读取用户当前正在编辑的文件。
3. 插件注册系统提示节（order 150，每轮 assembly 求值）：`[VS Code] Active file: <path> ...`，提示模型先读当前文件再动手。

1. The VS Code extension pushes a snapshot of the active editor (path, language, selection, dirty flag, ≤96 KiB content) to this plugin's `/vscode/active-file` endpoint on every switch/edit.
2. The plugin caches the latest snapshot and exposes the model tool **`vscode_active_file`**, so agents can always read what you are working on.
3. A system-prompt section (order 150, evaluated at every assembly) tells the model the current active file and points it at the tool.

## 安装 / Install

两个部分都要装：

1. **VS Code 扩展**：安装 `deepseek-harness-vscode` 的 vsix（仓库 Releases 下载），并保持 `dshHarness.trackActiveFile: true`（默认开启）。
2. **本插件**：在 DeepSeek Harness 中安装本包（`npm pack` 产物 `dsh-vscode-bridge-*.tgz`），或使用 dsh-super-injector 热装配：`dev_install_package {"dir": "<本目录>"}`（先 `npm run build` 产出 `lib/`）。

安装后无需重启：Agent 新建会话即可看到 `vscode_active_file` 工具与 `[VS Code] Active file:` 系统提示。

Both halves are required: the VS Code extension (vsix from Releases, `dshHarness.trackActiveFile` defaults to true) and this plugin (pack the tgz via `npm pack` and install it in your harness, or hot-mount with dsh-super-injector `dev_install_package` after `npm run build`). New agent sessions pick up the tool and prompt section immediately.

## 构建 / Build

```bash
DSH_CHECKOUT=<deepseek-harness checkout> bash scripts/build.sh   # 产出 lib/
npm pack                                                          # 产出 tgz
```

## 验证 / Verify

```bash
# 端点应存在
curl http://127.0.0.1:3080/vscode/active-file          # -> {"connected":false} 或快照
curl -X POST http://127.0.0.1:3080/vscode/active-file \
  -H 'content-type: application/json' -d '{"path":"C:/tmp/a.ts","relativePath":"a.ts","languageId":"typescript","content":"x","truncated":false,"modified":false,"timestamp":1}'
```

## 安全 / Security

`/vscode/active-file` 与 `/api` 网关同款浏览器信任围栏：Host 回环或 `--trusted-host` 授权、拒绝跨站浏览器标记；POST 体上限 256 KiB。该围栏是防 DNS rebinding / 跨站防御，不是认证。
The route uses the same browser-trust fence as the `/api` gateway (loopback Host or `--trusted-host` authorities, cross-site browser markers refused); POST bodies are capped at 256 KiB. This is a DNS-rebinding/cross-site defense, not authentication.

## License

BSD-3-Clause
