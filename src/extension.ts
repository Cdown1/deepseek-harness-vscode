/**
 * DeepSeek Harness for VS Code — entry point.
 *
 * Brings the DeepSeek Harness agent web UI (`dsh web`) into VS Code:
 *  - a webview panel that embeds the UI in an iframe,
 *  - automatic server detection and (optional) startup,
 *  - live active-file awareness: the file the user is editing is pushed to
 *    the harness bridge endpoint (/vscode/active-file) and exposed to agent
 *    sessions as the `vscode_active_file` tool ("Claude Code style" context),
 *  - a status bar item and output channel for the server process.
 */
import * as vscode from 'vscode'
import { ServerManager, type ServerState } from './server'
import { createPanel, type PanelMessage } from './panel'
import { StatusBarManager } from './status'
import { ActiveFileTracker, postActiveFile, type ActiveFilePayload } from './active-file'

let server: ServerManager
let panel: vscode.WebviewPanel | undefined
let statusBar: StatusBarManager
let output: vscode.OutputChannel
let lastState: ServerState = 'unknown'
let tracker: ActiveFileTracker | undefined
let trackingEnabled = false

function readConfig(): {
  url: string
  autoStart: boolean
  startCommand: string
  startTimeoutMs: number
  probeTimeoutMs: number
  openOnStartup: boolean
  trackActiveFile: boolean
} {
  const cfg = vscode.workspace.getConfiguration('dshHarness')
  return {
    url: cfg.get<string>('url', 'http://127.0.0.1:3080'),
    autoStart: cfg.get<boolean>('autoStart', true),
    startCommand: cfg.get<string>('startCommand', 'dsh web'),
    startTimeoutMs: cfg.get<number>('startTimeoutSec', 120) * 1000,
    probeTimeoutMs: cfg.get<number>('probeTimeoutMs', 2500),
    openOnStartup: cfg.get<boolean>('openOnStartup', false),
    trackActiveFile: cfg.get<boolean>('trackActiveFile', true),
  }
}

function buildServer(): ServerManager {
  const config = readConfig()
  const manager = new ServerManager({
    url: config.url,
    autoStart: config.autoStart,
    startCommand: config.startCommand,
    startTimeoutMs: config.startTimeoutMs,
    probeTimeoutMs: config.probeTimeoutMs,
    log: (line) => output.appendLine(line),
  })
  manager.on('state', onServerState)
  return manager
}

/** Push one active-file snapshot to the harness bridge route (only while online). */
function pushSnapshot(payload: ActiveFilePayload | null): void {
  if (lastState !== 'online') return
  void postActiveFile(server.url.toString(), payload).then((ok) => {
    if (!ok) output.appendLine('[active-file] push failed (server may have restarted)')
  })
}

/** Keep the tracker running in line with the trackActiveFile setting. */
function syncTracker(): void {
  const enabled = readConfig().trackActiveFile
  if (enabled === trackingEnabled) return
  trackingEnabled = enabled
  if (enabled) {
    tracker = new ActiveFileTracker(pushSnapshot)
    tracker.start()
    // Server may already be online — send the current file right away.
    if (lastState === 'online') tracker.flush()
  } else {
    tracker?.dispose()
    tracker = undefined
  }
}

function onServerState(state: ServerState): void {
  lastState = state
  statusBar.update(state, server.url.toString())
  if (panel) {
    void panel.webview.postMessage({ type: 'state', state, url: server.url.toString() })
  }
  // Reconnect: make sure the harness sees the current active file.
  if (state === 'online' && trackingEnabled) {
    tracker?.flush()
  }
}

async function syncServer(): Promise<void> {
  const state = await server.sync()
  lastState = state
  statusBar.update(state, server.url.toString())
  if (panel) {
    void panel.webview.postMessage({ type: 'state', state, url: server.url.toString() })
  }
  if (state === 'online' && trackingEnabled) {
    tracker?.flush()
  }
}

function openPanel(): void {
  if (panel) {
    panel.reveal()
    return
  }
  panel = createPanel(server.url.toString(), onPanelMessage)
  panel.onDidDispose(() => {
    panel = undefined
  })
  // Push the current state into the freshly created panel.
  void panel.webview.postMessage({ type: 'state', state: lastState, url: server.url.toString() })
  void syncServer()
}

function onPanelMessage(message: PanelMessage): void {
  if (message.type === 'retry') {
    void syncServer()
  } else if (message.type === 'openExternal') {
    void openInBrowser()
  }
}

async function openInBrowser(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(server.url.toString()))
}

async function startServer(): Promise<void> {
  if (lastState === 'online') {
    void vscode.window.showInformationMessage(
      `DeepSeek Harness is already running at ${server.url.toString()}`,
    )
    return
  }
  const state = await server.sync()
  lastState = state
  statusBar.update(state, server.url.toString())
  if (state !== 'online') {
    void vscode.window.showErrorMessage(
      'DeepSeek Harness server failed to start — see the "DeepSeek Harness" output channel.',
    )
  }
}

async function stopServer(): Promise<void> {
  if (lastState === 'offline' || lastState === 'unknown') {
    void vscode.window.showInformationMessage('DeepSeek Harness server is not running.')
    return
  }
  await server.stop()
}

function reloadPanel(): void {
  if (panel) {
    void panel.webview.postMessage({ type: 'reload', url: server.url.toString() })
  }
}

function reportActiveFile(): void {
  if (!trackingEnabled) {
    void vscode.window.showWarningMessage(
      'Active-file tracking is disabled — enable dshHarness.trackActiveFile to report files.',
    )
    return
  }
  if (lastState !== 'online') {
    void vscode.window.showWarningMessage(
      'DeepSeek Harness server is not running — start it first (dsh.startServer).',
    )
    return
  }
  tracker?.flush()
  const editor = vscode.window.activeTextEditor
  const name = editor !== undefined ? editor.document.uri.fsPath ?? '(untitled)' : '(no editor)'
  void vscode.window.showInformationMessage(`Reported active file to DeepSeek Harness: ${name}`)
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('DeepSeek Harness')
  statusBar = new StatusBarManager()
  server = buildServer()
  syncTracker()

  context.subscriptions.push(
    statusBar,
    output,
    vscode.commands.registerCommand('dsh.open', openPanel),
    vscode.commands.registerCommand('dsh.openInBrowser', openInBrowser),
    vscode.commands.registerCommand('dsh.startServer', startServer),
    vscode.commands.registerCommand('dsh.stopServer', stopServer),
    vscode.commands.registerCommand('dsh.refresh', reloadPanel),
    vscode.commands.registerCommand('dsh.reportActiveFile', reportActiveFile),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('dshHarness')) return
      const old = server
      server = buildServer()
      syncTracker()
      void old.stop().finally(() => {
        void syncServer()
        if (panel) reloadPanel()
      })
    }),
  )

  if (readConfig().openOnStartup) {
    openPanel()
  }
  // Background probe so the status bar and active-file pushes go live even
  // when the user never opens the panel.
  void syncServer()
}

export function deactivate(): void {
  tracker?.dispose()
  server?.dispose()
}
