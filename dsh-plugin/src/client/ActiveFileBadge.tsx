/**
 * Active-file badge — a small always-visible pill at the LEFT end of the
 * composer card's tool row (conversation.input.left), showing the file the
 * user is currently editing in VS Code, live.
 *
 * Renders nothing while no snapshot is reported, so the composer stays
 * untouched for deployments without the VS Code extension.
 */
import { useSyncExternalStore } from 'react'
import type { ActiveFileStore, ActiveFileSnapshot } from './active-file-store.ts'

export interface ActiveFileBadgeProps {
  store: ActiveFileStore
}

async function copyPath(path: string | null): Promise<void> {
  if (path === null) return
  try {
    await navigator.clipboard.writeText(path)
  } catch {
    // Clipboard can be unavailable (permissions, focus) — the badge stays
    // display-only in that case.
  }
}

function tooltipOf(snap: ActiveFileSnapshot): string {
  const lines = [
    snap.path ?? '',
    ...(snap.workspaceFolder !== null ? [`Workspace: ${snap.workspaceFolder}`] : []),
    ...(snap.languageId !== null ? [`Language: ${snap.languageId}`] : []),
    ...(snap.selection !== null
      ? [`Selection: ${snap.selection.startLine}:${snap.selection.startCharacter}`
        + `-${snap.selection.endLine}:${snap.selection.endCharacter}`]
      : []),
    ...(snap.modified ? ['Unsaved changes'] : []),
    ...(snap.truncated ? ['Content truncated'] : []),
    ...(snap.timestamp !== 0 ? [`As of ${new Date(snap.timestamp).toLocaleTimeString()}`] : []),
  ].filter(Boolean)
  return lines.length > 0 ? lines.join('\n') : 'VS Code active file'
}

export function ActiveFileBadge(props: ActiveFileBadgeProps): React.ReactNode {
  const snap = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  if (snap.state !== 'online' || snap.relativePath === null) return null
  return (
    <span
      className="dsh-vscode-active-file"
      title={tooltipOf(snap)}
      onClick={() => { void copyPath(snap.path) }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        maxWidth: '200px',
        padding: '1px 8px',
        borderRadius: '999px',
        border: '1px solid color-mix(in srgb, currentColor 35%, transparent)',
        fontSize: '11px',
        lineHeight: '16px',
        color: 'inherit',
        opacity: 0.92,
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          flexShrink: 0,
          background: snap.modified ? '#e5534b' : '#4d6bfe',
        }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {snap.relativePath}
        {snap.truncated ? ' …' : ''}
      </span>
    </span>
  )
}
