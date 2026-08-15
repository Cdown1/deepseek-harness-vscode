/**
 * Browser half of dsh-vscode-bridge: mounts the live active-file badge at the
 * left end of the composer card's tool row (conversation.input.left) and
 * keeps it fed from the polling store.
 *
 * Required services: the slots registry (the frame hands ids, not ctx — the
 * badge's injected share carries the store). The slot is declared by
 * ui-conversation's composer entry; `slots.inject` waits for the declaration.
 */
import { createActiveFileStore, type ActiveFileStore } from './active-file-store.ts'
import { ActiveFileBadge } from './ActiveFileBadge.tsx'

export { ActiveFileBadge } from './ActiveFileBadge.tsx'
export { createActiveFileStore } from './active-file-store.ts'
export type { ActiveFileStore, ActiveFileSnapshot } from './active-file-store.ts'

export interface ActiveFileBadgeInjected {
  store: ActiveFileStore
}

/** One named slot registration (structural mirror of @deepseek-ai/dsh-client-ui-slots). */
interface SlotRegisterOptions {
  name: string
  id?: string
  key?: string
  order?: number
  label?: string | (() => string)
  priority?: number
  inject?: (...args: unknown[]) => Record<string, unknown>
  children?: Record<string, unknown>
}

/** The slots registry face this plugin uses (structural mirror). */
interface SlotsService {
  register(options: SlotRegisterOptions, component: unknown): () => void
  inject(key: string, callback: () => () => void): () => void
}

type ClientContext = {
  slots: SlotsService
  effect(fn: () => void | (() => void), label?: string): void
}

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  // One store per activation (no module-level singleton — HMR-safe).
  const store = createActiveFileStore({ url: '/vscode/active-file', intervalMs: 2000 })
  ctx.effect(() => {
    const disposeRegistration = ctx.slots.inject('conversation.input.left', () =>
      ctx.slots.register({
        name: 'conversation.input.left',
        id: 'vscode-active-file',
        order: 50,
        label: () => 'VS Code active file',
        inject: (): Record<string, unknown> => ({ store }),
      }, ActiveFileBadge))
    return () => {
      disposeRegistration()
    }
  }, 'dsh-vscode-bridge: active-file badge')
  ctx.effect(() => () => { store.dispose() }, 'dsh-vscode-bridge: active-file store teardown')
}
