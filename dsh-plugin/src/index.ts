/**
 * @dsh-external/dsh-vscode-bridge — VS Code ↔ DeepSeek Harness live bridge.
 *
 * Gives every agent session "Claude Code style" awareness of the file the
 * user is currently viewing/editing in VS Code:
 *
 *  1. The VS Code extension (`deepseek-harness-vscode`) pushes a snapshot of
 *     the active editor (path, language, selection, dirty flag, bounded
 *     content) to POST /vscode/active-file whenever the user switches or
 *     edits a file.
 *  2. This plugin keeps the latest snapshot in memory and exposes it as the
 *     `vscode_active_file` tool, so the model can always read what the user
 *     is working on.
 *  3. A system-prompt section (order 150, evaluated at every assembly) tells
 *     the model the current active file and points it at the tool.
 *
 * Security: the route is fenced with the same browser-trust rules as the
 * /api gateway (Host-header loopback or the web runtime's trustedHosts,
 * cross-site browser markers refused) — a DNS-rebinding / cross-site
 * defense, not authentication. The POST payload is bounded in size.
 */
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { BridgeHttpRequest, BridgeHttpResponse } from './context-types.ts'

export const name = '@dsh-external/dsh-vscode-bridge'

/** Services required before mounting: tool registry, webserver routes, web runtime trust list, system prompt. */
export const inject = ['tools', 'webServer', 'webRuntime', 'systemPrompt']

/** Hard cap for one POST body (the extension already bounds content to 96 KiB). */
const MAX_BODY_BYTES = 256 * 1024

/** Route path (kept off /api — that prefix belongs to the RPC gateway). */
const ROUTE_PATH = '/vscode/active-file'

/** One snapshot pushed by the VS Code extension. */
export interface ActiveFileSnapshot {
  /** Absolute fsPath; null for untitled documents. */
  path: string | null
  /** Workspace-relative path, or the bare file name. */
  relativePath: string | null
  /** Workspace folder name, if any. */
  workspaceFolder: string | null
  /** VS Code language id. */
  languageId: string | null
  /** Bounded document text ("" when the file is empty). */
  content: string
  /** True when content hit the push limit. */
  truncated: boolean
  /** 1-based selection range, or null when there is no selection. */
  selection: {
    startLine: number
    startCharacter: number
    endLine: number
    endCharacter: number
  } | null
  /** Document has unsaved changes. */
  modified: boolean
  /** Epoch ms of the capture. */
  timestamp: number
}

// ---------------------------------------------------------------------------
// Browser-trust fence (behaviorally identical to the /api gateway's fence in
// @deepseek-ai/dsh-client-connection — copied here because the package does
// not export these helpers and the plugin must not depend on its internals).
// ---------------------------------------------------------------------------

function header(headers: BridgeHttpRequest['headers'], name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

function isTrustedApiRequest(request: BridgeHttpRequest, trustedHosts: readonly string[]): boolean {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Payload guard: accept a snapshot, keep it bounded and well-typed enough
// that junk cannot poison the tool result.
// ---------------------------------------------------------------------------

function sanitizeSnapshot(value: unknown): ActiveFileSnapshot | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const optString = (key: string): string | null =>
    typeof record[key] === 'string' ? record[key] as string : null
  let selection: ActiveFileSnapshot['selection'] = null
  const rawSelection = record.selection
  if (rawSelection !== null && typeof rawSelection === 'object') {
    const sel = rawSelection as Record<string, unknown>
    if (
      typeof sel.startLine === 'number' && typeof sel.startCharacter === 'number'
      && typeof sel.endLine === 'number' && typeof sel.endCharacter === 'number'
    ) {
      selection = {
        startLine: sel.startLine,
        startCharacter: sel.startCharacter,
        endLine: sel.endLine,
        endCharacter: sel.endCharacter,
      }
    }
  }
  return {
    path: optString('path'),
    relativePath: optString('relativePath'),
    workspaceFolder: optString('workspaceFolder'),
    languageId: optString('languageId'),
    content: typeof record.content === 'string' ? record.content : '',
    truncated: record.truncated === true,
    selection,
    modified: record.modified === true,
    timestamp: typeof record.timestamp === 'number' ? record.timestamp : Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Plugin body
// ---------------------------------------------------------------------------

export function apply(ctx: Context): void {
  let snapshot: ActiveFileSnapshot | null = null

  const fence = (req: BridgeHttpRequest): boolean =>
    isTrustedApiRequest(req, ctx.webRuntime.trustedHosts)

  // ── Route: /vscode/active-file ──────────────────────────────────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: (req: BridgeHttpRequest, res: BridgeHttpResponse) => {
      if (!fence(req)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' })
        res.end(JSON.stringify(snapshot === null
          ? { connected: false }
          : { connected: true, ...snapshot }))
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      let body = ''
      let overflow = false
      req.on('data', (chunk: Buffer) => {
        if (overflow) return
        body += chunk.toString('utf8')
        if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
          overflow = true
          req.destroy()
        }
      })
      req.on('end', () => {
        if (overflow) return
        try {
          const parsed: unknown = JSON.parse(body)
          const clean = sanitizeSnapshot(parsed)
          if (clean === null) {
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'payload must be a JSON object' }))
            return
          }
          snapshot = clean
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, receivedAt: Date.now() }))
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      })
    },
  }), 'dsh-vscode-bridge: /vscode/active-file route')

  // ── Tool: vscode_active_file ────────────────────────────────────────────
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'vscode_active_file',
    description:
      'Return the file the user is currently viewing or editing in VS Code, pushed live by the VS Code extension: '
      + 'absolute path, workspace-relative path, language, cursor selection, dirty flag, and the current content '
      + '(bounded — `truncated` marks overflow). Returns connected:false when no snapshot has been reported. '
      + 'Call this before proposing or making edits so your changes target the file the user actually has open.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          connected: { type: 'boolean', required: true, description: 'Whether the VS Code extension has reported an active file to this harness instance.' },
          path: { type: 'string', description: 'Absolute filesystem path of the active editor document (omitted for untitled documents).' },
          relativePath: { type: 'string', description: 'Path relative to the workspace folder, or the bare file name when no workspace is open.' },
          workspaceFolder: { type: 'string', description: 'Name of the VS Code workspace folder, when any.' },
          languageId: { type: 'string', description: 'VS Code language identifier (e.g. typescript, python, markdown).' },
          content: { type: 'string', description: 'Current file content as pushed by the extension (bounded).' },
          truncated: { type: 'boolean', description: 'True when the pushed content was truncated at the limit.' },
          selection: {
            type: 'object',
            additionalProperties: false,
            properties: {
              startLine: { type: 'number', description: '1-based start line.' },
              startCharacter: { type: 'number', description: '1-based start character.' },
              endLine: { type: 'number', description: '1-based end line (== startLine for a caret).' },
              endCharacter: { type: 'number', description: '1-based end character.' },
            },
            description: 'Cursor selection range, when the editor has one.',
          },
          modified: { type: 'boolean', description: 'Whether the document has unsaved changes.' },
          timestamp: { type: 'number', description: 'Epoch milliseconds of the snapshot capture.' },
        },
      },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: renderSnapshot(value) }],
    },
    execute: async () => {
      const snap = snapshot
      if (snap === null) return { connected: false }
      const out: {
        connected: boolean
        path?: string
        relativePath?: string
        workspaceFolder?: string
        languageId?: string
        content?: string
        truncated?: boolean
        selection?: { startLine: number; startCharacter: number; endLine: number; endCharacter: number }
        modified?: boolean
        timestamp?: number
      } = { connected: true }
      if (snap.path !== null) out.path = snap.path
      if (snap.relativePath !== null) out.relativePath = snap.relativePath
      if (snap.workspaceFolder !== null) out.workspaceFolder = snap.workspaceFolder
      if (snap.languageId !== null) out.languageId = snap.languageId
      if (snap.content !== '') out.content = snap.content
      out.truncated = snap.truncated
      if (snap.selection !== null) out.selection = snap.selection
      out.modified = snap.modified
      out.timestamp = snap.timestamp
      return out
    },
  })), 'dsh-vscode-bridge: vscode_active_file tool')

  // ── System prompt section: evaluated at every assembly ──────────────────
  // Order 150 sits in the tool-guidance band (100–199). An empty string is
  // dropped, so the section contributes nothing until a snapshot exists.
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'vscode:active-file',
    order: 150,
    text: () => {
      const snap = snapshot
      if (snap === null) return ''
      const where = snap.relativePath ?? snap.path ?? '(untitled)'
      const selection = snap.selection !== null
        ? `, selection ${snap.selection.startLine}:${snap.selection.startCharacter}-${snap.selection.endLine}:${snap.selection.endCharacter}`
        : ''
      const dirty = snap.modified ? ', unsaved changes' : ''
      return `[VS Code] Active file: ${where} (${snap.languageId ?? 'plaintext'}${selection}${dirty}). `
        + 'Use the vscode_active_file tool to read its full content before editing.'
    },
  }), 'dsh-vscode-bridge: system prompt section')
}

/** Pure text projection of the tool result for the transcript. */
function renderSnapshot(value: unknown): string {
  const record = (value ?? {}) as Record<string, unknown>
  if (record.connected !== true) {
    return 'No active file reported by the VS Code extension yet (connected: false).'
  }
  const where = typeof record.relativePath === 'string'
    ? record.relativePath
    : typeof record.path === 'string' ? record.path : '(untitled)'
  const lines: string[] = [
    `Active file: ${where}`,
    ...(typeof record.languageId === 'string' ? [`Language: ${record.languageId}`] : []),
    ...(typeof record.path === 'string' ? [`Absolute path: ${record.path}`] : []),
  ]
  const sel = record.selection as Record<string, unknown> | undefined
  if (sel !== null && typeof sel === 'object') {
    lines.push(`Selection: line ${String(sel.startLine)} char ${String(sel.startCharacter)}`
      + ` to line ${String(sel.endLine)} char ${String(sel.endCharacter)}`)
  }
  if (record.modified === true) lines.push('Unsaved changes present')
  if (typeof record.content === 'string' && record.content !== '') {
    lines.push(`Content (${record.truncated === true ? 'truncated, ' : ''}${record.content.length} chars):`)
    lines.push(record.content)
  }
  return lines.join('\n')
}
