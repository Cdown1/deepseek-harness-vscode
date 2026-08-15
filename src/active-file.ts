/**
 * ActiveFileTracker — watches the VS Code active editor and emits snapshots
 * for the DeepSeek Harness bridge endpoint (/vscode/active-file).
 *
 * Fires on editor switch and on document changes in the active editor
 * (debounced), plus an immediate flush when the server comes online.
 */
import * as vscode from 'vscode'
import { basename, relative } from 'node:path'

export interface ActiveFileSelection {
  startLine: number
  startCharacter: number
  endLine: number
  endCharacter: number
}

export interface ActiveFilePayload {
  /** Absolute fsPath; null for untitled documents. */
  path: string | null
  /** Workspace-relative path, or the bare file name. */
  relativePath: string | null
  /** Workspace folder name, if any. */
  workspaceFolder: string | null
  /** VS Code language id. */
  languageId: string | null
  /** Bounded document text. */
  content: string
  /** True when content was truncated at the push limit. */
  truncated: boolean
  /** 1-based selection range, or null when there is no selection. */
  selection: ActiveFileSelection | null
  /** Document has unsaved changes. */
  modified: boolean
  /** Epoch ms of the capture. */
  timestamp: number
}

/** Content push limit, in UTF-8 bytes (kept well under the bridge's 256 KiB body cap). */
const CONTENT_LIMIT_BYTES = 96 * 1024

/** Debounce window for document-change pushes, in ms. */
const DEBOUNCE_MS = 350

export class ActiveFileTracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []
  private timer: NodeJS.Timeout | undefined
  private enabled = false

  constructor(private readonly onSnapshot: (payload: ActiveFilePayload | null) => void) {}

  /** Begin watching the active editor (idempotent). */
  start(): void {
    if (this.enabled) return
    this.enabled = true
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document) this.schedule()
      }),
    )
    this.schedule()
  }

  /** Stop watching and drop any pending push. */
  stop(): void {
    if (!this.enabled) return
    this.enabled = false
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  /** Emit the current editor state immediately, bypassing the debounce. */
  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.onSnapshot(this.capture())
  }

  private schedule(): void {
    if (!this.enabled) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.onSnapshot(this.capture())
    }, DEBOUNCE_MS)
  }

  private capture(): ActiveFilePayload | null {
    const editor = vscode.window.activeTextEditor
    if (editor === undefined) return null
    const document = editor.document
    const text = document.getText()
    const bytes = Buffer.from(text, 'utf8')
    const truncated = bytes.byteLength > CONTENT_LIMIT_BYTES
    let content = text
    if (truncated) {
      // Never split a multi-byte UTF-8 sequence at the cap.
      let end = CONTENT_LIMIT_BYTES
      while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1
      content = bytes.subarray(0, end).toString('utf8')
    }
    const fsPath = document.uri.scheme === 'file' ? document.uri.fsPath : null
    let relativePath: string | null = null
    let workspaceFolder: string | null = null
    if (fsPath !== null) {
      const folder = vscode.workspace.getWorkspaceFolder(document.uri)
      workspaceFolder = folder?.name ?? null
      relativePath = folder !== undefined
        ? relative(folder.uri.fsPath, fsPath)
        : basename(fsPath)
    }
    const selection = editor.selection.isEmpty
      ? null
      : {
        startLine: editor.selection.start.line + 1,
        startCharacter: editor.selection.start.character + 1,
        endLine: editor.selection.end.line + 1,
        endCharacter: editor.selection.end.character + 1,
      }
    return {
      path: fsPath,
      relativePath,
      workspaceFolder,
      languageId: document.languageId,
      content,
      truncated,
      selection,
      modified: document.isDirty,
      timestamp: Date.now(),
    }
  }

  dispose(): void {
    this.stop()
  }
}

/** POST one snapshot to the harness bridge route. Returns true on 2xx. */
export async function postActiveFile(baseUrl: string, payload: ActiveFilePayload | null): Promise<boolean> {
  try {
    const target = new URL('/vscode/active-file', baseUrl)
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}
