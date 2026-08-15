/**
 * DeepSeek Harness for VS Code — entry point.
 *
 * Brings the DeepSeek Harness agent web UI (`dsh web`) into VS Code:
 *  - a webview panel that embeds the UI in an iframe,
 *  - automatic server detection and (optional) startup,
 *  - a status bar item and output channel for the server process.
 */
import * as vscode from 'vscode'
import { ServerManager, type ServerState } from './server'
import { createPanel, type PanelMessage } from './panel'
import { StatusBarManager } from './status'

const EXTENSION_ID = 'deepseek-harness.deepseek-harness-vscode'

let server: ServerManager
let panel: vscode.WebviewPanel | undefined
let statusBar: StatusBarManager
let output: vscode.OutputChannel
let lastState: ServerState = 'unknown'

function readConfig(): {
  url: string
  autoStart: boolean
  startCommand: string
  startTimeoutMs: number
  probeTimeoutMs: number
  openOnStartup: boolean
} {
  const cfg = vscode.workspace.getConfiguration('dshHarness')
  return {
    url: cfg.get<string>('url', 'http://127.0.0.1:3080'),
    autoStart: cfg.get<boolean>('autoStart', true),
    startCommand: cfg.get<string>('startCommand', 'dsh web'),
    startTimeoutMs: cfg.get<number>('startTimeoutSec', 120) * 1000,
    probeTimeoutMs: cfg.get<number>('probeTimeoutMs', 2500),
    openOnStartup: cfg.get<boolean>('openOnStartup', false),
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

function onServerState(state: ServerState): void {
  lastState = state
  statusBar.update(state, server.url.toString())
  if (panel) {
    void panel.webview.postMessage({ type: 'state', state, url: server.url.toString() })
  }
}

async function syncServer(): Promise<void> {
  const state = await server.sync()
  lastState = state
  statusBar.update(state, server.url.toString())
  if (panel) {
    void panel.webview.postMessage({ type: 'state', state, url: server.url.toString() })
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

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('DeepSeek Harness')
  statusBar = new StatusBarManager()
  server = buildServer()

  context.subscriptions.push(
    statusBar,
    output,
    vscode.commands.registerCommand('dsh.open', openPanel),
    vscode.commands.registerCommand('dsh.openInBrowser', openInBrowser),
    vscode.commands.registerCommand('dsh.startServer', startServer),
    vscode.commands.registerCommand('dsh.stopServer', stopServer),
    vscode.commands.registerCommand('dsh.refresh', reloadPanel),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('dshHarness')) return
      const old = server
      server = buildServer()
      void old.stop().finally(() => {
        void syncServer()
        if (panel) reloadPanel()
      })
    }),
  )

  if (readConfig().openOnStartup) {
    openPanel()
  }
}

export function deactivate(): void {
  server?.dispose()
}
