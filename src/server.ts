/**
 * ServerManager — pure-Node manager for the DeepSeek Harness web server.
 *
 * Kept free of any `vscode` import so the probe / spawn / poll / stop pipeline
 * can be exercised by plain Node smoke tests (see scripts/smoke.mjs).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

export type ServerState =
  | 'unknown'
  | 'starting'
  | 'online'
  | 'offline'
  | 'stopping'
  | 'error'

export interface ProbeResult {
  online: boolean
  status?: number
  error?: string
}

export interface ServerManagerOptions {
  /** Base URL of the DeepSeek Harness web server, e.g. http://127.0.0.1:3080 */
  url: string
  /** Whether a missing server may be started with `startCommand`. */
  autoStart: boolean
  /** Shell command that brings the server up (e.g. `dsh web`). */
  startCommand: string
  /** How long to poll for the server after spawning, in ms. */
  startTimeoutMs: number
  /** Per-probe timeout, in ms. */
  probeTimeoutMs: number
  /** Log sink for child process output. */
  log?: (line: string) => void
  /** Test hook: invoked right before the start command is spawned. */
  beforeSpawn?: () => void
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Health probe: any successful HTTP response below 500 means the server is
 * reachable. The DeepSeek Harness `/api` trust fence only accepts loopback by
 * default, so probing the root document (served by frontend-static) is the
 * reliable liveness check.
 */
export class ServerManager extends EventEmitter {
  private child: ChildProcess | null = null
  private stopping = false
  private state: ServerState = 'unknown'
  readonly url: URL
  private readonly opts: ServerManagerOptions

  constructor(opts: ServerManagerOptions) {
    super()
    this.opts = opts
    this.url = new URL(opts.url)
  }

  getState(): ServerState {
    return this.state
  }

  isChildRunning(): boolean {
    return this.child !== null && this.child.exitCode === null && !this.child.killed
  }

  private setState(state: ServerState): void {
    if (state === this.state) return
    this.state = state
    this.emit('state', state)
  }

  /** One-shot liveness probe. Never spawns anything. */
  async probe(): Promise<ProbeResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.opts.probeTimeoutMs)
    try {
      const res = await fetch(this.url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
      })
      return { online: res.status < 500, status: res.status }
    } catch (error) {
      return { online: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Bring the server to a usable state:
   * 1. probe — already online and we are done;
   * 2. otherwise spawn `startCommand` (if autoStart) and poll until online or
   *    the start timeout expires.
   * Returns the resulting state.
   */
  async sync(): Promise<ServerState> {
    const first = await this.probe()
    if (first.online) {
      this.setState('online')
      return this.state
    }
    if (!this.opts.autoStart) {
      this.setState('offline')
      return this.state
    }
    this.setState('starting')
    this.spawnChild()
    const deadline = Date.now() + this.opts.startTimeoutMs
    for (;;) {
      await delay(1500)
      if (this.state === 'offline' && !this.isChildRunning()) {
        // Child already exited and nothing is listening.
        this.setState('error')
        return this.state
      }
      const result = await this.probe()
      if (result.online) {
        this.setState('online')
        return this.state
      }
      if (Date.now() >= deadline) {
        this.setState('error')
        return this.state
      }
    }
  }

  private spawnChild(): void {
    if (this.isChildRunning()) return
    this.opts.beforeSpawn?.()
    this.stopping = false
    const command = this.opts.startCommand
    const isWin = process.platform === 'win32'
    const child = isWin
      ? spawn('cmd.exe', ['/c', command], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn('/bin/sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    const sink = (chunk: Buffer) => this.opts.log?.(String(chunk).replace(/\s+$/u, ''))
    child.stdout?.on('data', sink)
    child.stderr?.on('data', sink)
    child.on('error', (error) => {
      this.opts.log?.(`[dsh-vscode] spawn error: ${error.message}`)
      this.child = null
      this.setState('offline')
    })
    child.on('exit', (code, signal) => {
      this.opts.log?.(`[dsh-vscode] server process exited (code=${String(code)}, signal=${String(signal)})`)
      this.child = null
      this.setState('offline')
    })
  }

  /** Stop the spawned server process (process tree on Windows). */
  async stop(): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null || child.killed) return
    this.stopping = true
    this.setState('stopping')
    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          windowsHide: true,
          stdio: 'ignore',
        })
        killer.on('exit', () => resolve())
        killer.on('error', () => resolve())
      })
    } else {
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const force = setTimeout(() => {
          try { child.kill('SIGKILL') } catch { /* already gone */ }
          resolve()
        }, 3000)
        child.once('exit', () => {
          clearTimeout(force)
          resolve()
        })
      })
    }
    this.stopping = false
    this.child = null
    this.setState('offline')
  }

  dispose(): void {
    void this.stop()
    this.removeAllListeners()
  }
}
