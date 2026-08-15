/**
 * Active-file store (browser half of dsh-vscode-bridge).
 *
 * Polls the host route GET /vscode/active-file (same origin, so it rides the
 * loopback trust fence) and exposes a framework-style snapshot store:
 * `getSnapshot()` + `subscribe()` — safe for useSyncExternalStore.
 * Only notifies on change, so the badge does not re-render every tick.
 */
export interface ActiveFileSelection {
  startLine: number
  startCharacter: number
  endLine: number
  endCharacter: number
}

export type ActiveFileState = 'loading' | 'online' | 'no-file' | 'offline'

export interface ActiveFileSnapshot {
  state: ActiveFileState
  /** Absolute path; null for untitled documents. */
  path: string | null
  /** Workspace-relative path, or the bare file name. */
  relativePath: string | null
  /** Workspace folder name, if any. */
  workspaceFolder: string | null
  /** VS Code language id. */
  languageId: string | null
  /** Content was truncated at the push limit. */
  truncated: boolean
  /** Document has unsaved changes. */
  modified: boolean
  /** 1-based selection range, or null. */
  selection: ActiveFileSelection | null
  /** Epoch ms of the snapshot capture. */
  timestamp: number
}

export interface ActiveFileStore {
  getSnapshot(): ActiveFileSnapshot
  subscribe(listener: () => void): () => void
  dispose(): void
}

const EMPTY: ActiveFileSnapshot = Object.freeze({
  state: 'loading',
  path: null,
  relativePath: null,
  workspaceFolder: null,
  languageId: null,
  truncated: false,
  modified: false,
  selection: null,
  timestamp: 0,
})

function sameSnapshot(a: ActiveFileSnapshot, b: ActiveFileSnapshot): boolean {
  return a.state === b.state
    && a.path === b.path
    && a.relativePath === b.relativePath
    && a.workspaceFolder === b.workspaceFolder
    && a.languageId === b.languageId
    && a.truncated === b.truncated
    && a.modified === b.modified
    && a.timestamp === b.timestamp
    && JSON.stringify(a.selection) === JSON.stringify(b.selection)
}

export function createActiveFileStore(options: {
  url: string
  intervalMs?: number
}): ActiveFileStore {
  const intervalMs = options.intervalMs ?? 2000
  let snapshot: ActiveFileSnapshot = EMPTY
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const set = (next: ActiveFileSnapshot): void => {
    if (sameSnapshot(snapshot, next)) return
    snapshot = next
    notify()
  }

  const poll = async (): Promise<void> => {
    if (disposed) return
    try {
      const response = await fetch(new URL(options.url, window.location.origin), {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
        headers: { accept: 'application/json' },
      })
      if (!response.ok) {
        set({ ...EMPTY, state: 'offline' })
        return
      }
      const data: unknown = await response.json()
      const record = (data ?? {}) as Record<string, unknown>
      if (record.connected !== true) {
        set({ ...EMPTY, state: 'no-file' })
        return
      }
      const optString = (key: string): string | null =>
        typeof record[key] === 'string' ? record[key] as string : null
      const rawSelection = record.selection
      let selection: ActiveFileSelection | null = null
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
      set({
        state: 'online',
        path: optString('path'),
        relativePath: optString('relativePath'),
        workspaceFolder: optString('workspaceFolder'),
        languageId: optString('languageId'),
        truncated: record.truncated === true,
        modified: record.modified === true,
        selection,
        timestamp: typeof record.timestamp === 'number' ? record.timestamp : Date.now(),
      })
    } catch {
      set({ ...EMPTY, state: 'offline' })
    } finally {
      if (!disposed) timer = setTimeout(() => { void poll() }, intervalMs)
    }
  }

  void poll()

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose: () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      listeners.clear()
    },
  }
}
