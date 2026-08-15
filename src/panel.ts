/**
 * Webview panel — embeds the DeepSeek Harness web UI in an iframe.
 *
 * The extension host talks to the panel through a small message protocol:
 *   host -> panel: { type: 'state', state, url }  ({ type: 'reload', url })
 *   panel -> host: { type: 'retry' | 'openExternal' }
 */
import * as vscode from 'vscode'

const EXTENSION_ID = 'deepseek-harness.deepseek-harness-vscode'

export interface PanelMessage {
  type: string
  [key: string]: unknown
}

export type PanelState = 'unknown' | 'starting' | 'online' | 'offline' | 'stopping' | 'error'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function panelHtml(url: string): string {
  const safeUrl = escapeHtml(url)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; frame-src http: https:;">
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden;
    background: var(--vscode-editor-background, #1e1e1e); }
  #frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  #overlay { position: absolute; inset: 0; z-index: 10; display: none;
    align-items: center; justify-content: center;
    background: var(--vscode-editor-background, #1e1e1e); }
  #overlay.visible { display: flex; }
  .card { max-width: 420px; margin: 24px; padding: 24px 28px;
    border: 1px solid var(--vscode-widget-border, #3c3c3c); border-radius: 8px;
    background: var(--vscode-editorWidget-background, #252526);
    color: var(--vscode-foreground, #cccccc);
    font-family: var(--vscode-font-family); }
  .card h2 { margin: 0 0 10px; font-size: 16px; }
  .card p { margin: 0 0 16px; font-size: 13px; line-height: 1.5;
    word-break: break-all; }
  .row { display: flex; gap: 8px; }
  button { flex: 1; padding: 6px 12px; border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 4px; background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #ffffff); cursor: pointer; font-size: 13px; }
  button.secondary { background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ffffff); }
  button:hover { opacity: 0.9; }
  .badge { display: inline-block; margin-bottom: 10px; padding: 2px 8px;
    border-radius: 10px; font-size: 11px; }
  .badge.starting { background: #b89500; color: #fff; }
  .badge.error { background: #a1260d; color: #fff; }
  .badge.offline { background: #6e7681; color: #fff; }
</style>
</head>
<body>
<div id="overlay">
  <div class="card">
    <span id="badge" class="badge offline">offline</span>
    <h2>DeepSeek Harness</h2>
    <p id="ovText">Waiting…</p>
    <div class="row">
      <button id="retry">Retry</button>
      <button id="browser" class="secondary">Open in Browser</button>
    </div>
  </div>
</div>
<iframe id="frame" src="${safeUrl}" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
<script>
  const vscode = acquireVsCodeApi();
  const overlay = document.getElementById('overlay');
  const badge = document.getElementById('badge');
  const text = document.getElementById('ovText');
  const frame = document.getElementById('frame');
  const LABELS = {
    starting: 'Starting the DeepSeek Harness server, please wait…',
    stopping: 'Stopping the DeepSeek Harness server…',
    offline: 'The DeepSeek Harness server is not reachable.',
    error: 'Could not start the DeepSeek Harness server. See the "DeepSeek Harness" output channel for details.',
    unknown: 'Waiting…'
  };
  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'state') {
      const state = msg.state || 'unknown';
      if (state === 'online') {
        overlay.classList.remove('visible');
        badge.className = 'badge';
        badge.textContent = 'online';
      } else {
        overlay.classList.add('visible');
        badge.className = 'badge ' + state;
        badge.textContent = state;
        text.textContent = LABELS[state] || LABELS.unknown;
      }
    } else if (msg.type === 'reload') {
      if (msg.url && msg.url !== frame.getAttribute('src')) {
        frame.setAttribute('src', msg.url);
      } else {
        frame.setAttribute('src', frame.getAttribute('src') + '?vscodeReload=' + Date.now());
      }
    }
  });
  document.getElementById('retry').addEventListener('click', () => vscode.postMessage({ type: 'retry' }));
  document.getElementById('browser').addEventListener('click', () => vscode.postMessage({ type: 'openExternal' }));
</script>
</body>
</html>`
}

export function createPanel(
  url: string,
  onMessage: (message: PanelMessage) => void,
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'dsh.panel',
    'DeepSeek Harness',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    },
  )
  panel.iconPath = vscode.Uri.joinPath(
    vscode.extensions.getExtension(EXTENSION_ID)?.extensionUri ?? vscode.Uri.parse(''),
    'media',
    'icon.png',
  )
  panel.webview.html = panelHtml(url)
  panel.webview.onDidReceiveMessage(onMessage)
  return panel
}
