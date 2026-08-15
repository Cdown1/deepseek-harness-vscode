/**
 * Smoke tests for the extension's server-manager pipeline (pure Node, no VS Code).
 *
 * Run after `npm run compile`:
 *   node scripts/smoke.mjs
 *
 * Covers:
 *   1. probe against a live DeepSeek Harness server (default http://127.0.0.1:3080)
 *   2. probe against a dead port
 *   3. sync() must NOT spawn when the server is already online
 *   4. full pipeline: spawn a fake HTTP server -> poll until online -> stop -> offline
 */
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const { ServerManager } = require('../dist/server.js')

const LIVE_URL = process.env.DSH_URL ?? 'http://127.0.0.1:3080'
const DEAD_URL = 'http://127.0.0.1:39999'
const FAKE_PORT = 39997

const base = (overrides = {}) => ({
  url: LIVE_URL,
  autoStart: false,
  startCommand: 'echo nope',
  startTimeoutMs: 20000,
  probeTimeoutMs: 2000,
  log: () => {},
  ...overrides,
})

// 1. Live server probe
{
  const manager = new ServerManager(base())
  const result = await manager.probe()
  assert.equal(result.online, true, `live DSH should be online, got ${JSON.stringify(result)}`)
  assert.ok(result.status !== undefined && result.status < 500)
  console.log('✓ 1. live server probe -> online')
}

// 2. Dead port probe
{
  const manager = new ServerManager(base({ url: DEAD_URL }))
  const result = await manager.probe()
  assert.equal(result.online, false, 'dead port must probe offline')
  assert.ok(typeof result.error === 'string' || result.status === undefined)
  console.log('✓ 2. dead port probe -> offline')
}

// 3. No spawn when already online
{
  let spawned = 0
  const manager = new ServerManager(base({ autoStart: true, beforeSpawn: () => { spawned += 1 } }))
  const state = await manager.sync()
  assert.equal(state, 'online')
  assert.equal(spawned, 0, 'must not spawn when the server is already online')
  console.log('✓ 3. sync() skips spawn when already online')
}

// 4. Full spawn -> poll -> stop pipeline with a fake HTTP server
{
  // Use a temp file instead of `node -e "..."` so cmd.exe quoting never matters.
  const { writeFileSync, unlinkSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const fakeFile = join(tmpdir(), `dsh-vscode-smoke-${process.pid}.js`)
  writeFileSync(
    fakeFile,
    `const http=require('http');http.createServer((q,s)=>{s.end('ok')}).listen(${FAKE_PORT},'127.0.0.1')`,
  )
  const manager = new ServerManager(base({
    url: `http://127.0.0.1:${FAKE_PORT}`,
    autoStart: true,
    startCommand: `node ${fakeFile}`,
    log: (line) => console.log(`   [fake] ${line}`),
  }))
  const state = await manager.sync()
  assert.equal(state, 'online', `fake server should come online, got ${state}`)
  console.log('✓ 4a. spawned command polled online')

  await manager.stop()
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const after = await manager.probe()
  assert.equal(after.online, false, 'server must be offline after stop()')
  assert.equal(manager.getState(), 'offline')
  unlinkSync(fakeFile)
  console.log('✓ 4b. stop() released the port')
}

console.log('\nAll smoke tests passed.')
