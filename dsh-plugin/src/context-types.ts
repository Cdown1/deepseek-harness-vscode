/**
 * Structural types for the cordis services this plugin consumes, plus the
 * Context augmentation. A third-party plugin resolves outside the DSH
 * monorepo's single cordis instance, so the upstream `declare module`
 * augmentations do not reach this Context. The members below mirror the
 * actual runtime shapes this plugin touches:
 * - webServer: @deepseek-ai/dsh-host-webserver (route registration)
 * - webRuntime: @deepseek-ai/dsh-web-app (bind-derived trusted hosts)
 * Drift from upstream is contained to this file.
 */
import type { Context } from 'cordis'

/** The request face route handlers see (structural subset of node's IncomingMessage). */
export interface BridgeHttpRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
  on(event: 'data', listener: (chunk: Buffer) => void): void
  on(event: 'end', listener: () => void): void
  destroy(): void
}

/** The response face route handlers write to (structural subset of ServerResponse). */
export interface BridgeHttpResponse {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

/** One named webserver route (mirror of the host-webserver WebRoute). */
export interface BridgeWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: BridgeHttpRequest, res: BridgeHttpResponse) => void | Promise<void>
}

/** The webServer service face this plugin uses. */
export interface BridgeWebServer {
  register(route: BridgeWebRoute): () => void
}

/** The web runtime service face (trust list the /api gateway fence derives). */
export interface BridgeWebRuntime {
  trustedHosts: readonly string[]
}

declare module 'cordis' {
  interface Context {
    webServer: BridgeWebServer
    webRuntime: BridgeWebRuntime
  }
}

export type { Context }
