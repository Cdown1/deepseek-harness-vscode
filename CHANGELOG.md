# Changelog

## bridge v0.2.0

- Composer badge: the chat input's tool row shows the live VS Code active file (name, unsaved-changes dot, truncation marker; hover tooltip with path/language/selection/time; click copies the absolute path)
- Client half of dsh-vscode-bridge (tsdown bundle, `conversation.input.left` slot, 2s polling store); verified in a real browser: badge DOM + rendered dot

## 0.1.1

- Active-file awareness ("Claude Code style"): the extension tracks the file you are viewing/editing (path, language, selection, dirty flag, ≤96 KiB content) and pushes it to the harness `/vscode/active-file` endpoint in real time
- New `dshHarness.trackActiveFile` setting (default true) and `DeepSeek Harness: Report Active File` command
- New bundled harness-side plugin `dsh-plugin/` (`dsh-vscode-bridge`, v0.1.0): `/vscode/active-file` route (trust-fenced), `vscode_active_file` tool, and a per-turn `[VS Code] Active file: ...` system-prompt section

## 0.1.0

- Initial release / 首个版本
  - Webview panel embedding the DeepSeek Harness web UI (iframe)
  - Server auto-detection, auto-start (`dsh web`) and ready-polling
  - Status bar indicator, browser fallback, reload command
  - Settings: URL, start command, timeouts, auto-open
