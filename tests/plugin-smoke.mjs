// Real V2 server and packaged Electron host; isolated data, no model calls.
import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { OpenCode } from '@opencode/client'
import { nodeExecutable } from '../plugins/launcher.mjs'
import { normalizeMessages, normalizeEvent } from '../plugins/v2-api.mjs'
import { Dashboard } from '../plugins/dashboard-rpc.mjs'

const root = resolve('.')
const packageRoot = process.env.VIBETRACE_TEST_PACKAGE_ROOT || root
const configuredPackage = process.env.VIBETRACE_TEST_LOCAL_PACKAGE === '1'
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
assert.equal(packageJson.exports['./server'], packageJson.main)
assert.equal(typeof (await import('../plugins/vibetrace.mjs')).default.setup, 'function')
const forbiddenHelper = resolve(tmpdir(), 'not-a-node-electron-helper')
for (const versions of [{ electron: 'desktop' }, { bun: 'terminal' }]) {
  assert.equal(nodeExecutable(undefined, { versions, execPath: forbiddenHelper }), process.execPath)
}
assert.throws(() => nodeExecutable(forbiddenHelper), /could not find a working Node.js/)
assert.throws(() => nodeExecutable('/usr/bin/true'), /could not find a working Node.js/)
const normalized = normalizeMessages([
  { type: 'user', id: 'u', text: 'Review', time: { created: 1 } },
  { type: 'assistant', id: 'a', model: { providerID: 'test', id: 'model' }, time: { created: 2, completed: 3 }, finish: 'stop',
    content: [{ type: 'reasoning', text: 'Think' }, { type: 'tool', id: 'call', name: 'shell', time: { created: 2, completed: 3 }, state: { status: 'completed', input: { command: 'pwd' }, content: [{ type: 'text', text: '/workspace' }] } }, { type: 'text', text: 'Done' }] },
], 'session')
assert.equal(normalized[1].info.parentID, 'u')
assert.equal(normalized[1].info.model.modelID, 'model')
assert.equal(normalized[1].parts[1].state.output, '/workspace')
assert.equal(normalizeEvent({ type: 'session.status', data: { sessionID: 's', status: { type: 'busy' } } }).payload.properties.status.type, 'busy')

const temp = mkdtempSync(resolve(tmpdir(), 'vibetrace-v2-smoke-'))
const project = resolve(temp, 'project')
const configHome = resolve(temp, 'config')
const states = resolve(temp, 'runtime')
mkdirSync(project, { recursive: true })
mkdirSync(resolve(configHome, 'opencode'), { recursive: true })
// Local provider fixture exercises the real agent and worker request paths
// without contacting an external model or consuming a user's quota.
let providerCalls = 0
const provider = http.createServer(async (req, res) => {
  for await (const _ of req) { /* consume request */ }
  providerCalls++
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const base = { id: 'chatcmpl-vibetrace', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'test' }
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'V2 local response' }, finish_reason: null }] })}\n\n`)
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } })}\n\n`)
  res.end('data: [DONE]\n\n')
})
await new Promise(ok => provider.listen(0, '127.0.0.1', ok))
writeFileSync(resolve(configHome, 'opencode/opencode.json'), JSON.stringify({
  ...(configuredPackage ? { plugins: [{ package: packageRoot, options: { node: nodeExecutable(), python: 'python3' } }] } : {}),
  model: 'vibetrace-test/test', agents: { title: { model: 'vibetrace-test/test' } },
  providers: { 'vibetrace-test': { package: '@opencode/ai/providers/openai-compatible',
    settings: { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'local-test-only' },
    models: { test: { name: 'Local test', limit: { context: 32000, output: 2048 } } } } },
}))
if (!configuredPackage) {
  const installed = spawnSync(process.execPath, [resolve(packageRoot, 'scripts/vibetrace.mjs'), 'install', '--plugin-dir', resolve(configHome, 'opencode/plugins')], { encoding: 'utf8' })
  assert.equal(installed.status, 0, installed.stderr)
}
const blocker = http.createServer((req, res) => res.end('unrelated service'))
let ownsBlocker = false
await new Promise((ok, reject) => {
  blocker.once('error', e => e.code === 'EADDRINUSE' ? ok() : reject(e))
  blocker.listen(5174, '127.0.0.1', () => { ownsBlocker = true; ok() })
})
const reservation = http.createServer()
await new Promise(ok => reservation.listen(0, '127.0.0.1', ok))
const port = reservation.address().port
await new Promise(ok => reservation.close(ok))
let base = `http://127.0.0.1:${port}`
let password = 'vibetrace-v2-smoke-only'
const env = { ...process.env, HOME: temp, XDG_CONFIG_HOME: configHome, XDG_STATE_HOME: resolve(temp, 'state'), XDG_DATA_HOME: resolve(temp, 'data'), XDG_CACHE_HOME: resolve(temp, 'cache'), OPENCODE_CONFIG: resolve(configHome, 'opencode/opencode.json'), OPENCODE_PASSWORD: password, VIBETRACE_OPENCODE_URL: base, VIBETRACE_RUNTIME_DIR: states, VIBETRACE_NO_BROWSER: '1' }
const shared = process.env.VIBETRACE_TEST_SHARED === '1'
if (shared) delete env.VIBETRACE_OPENCODE_URL
const child = spawn('opencode', ['serve', ...(shared ? ['--service'] : []), '--hostname', '127.0.0.1', '--port', String(port)], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-12000) })
const wait = ms => new Promise(ok => setTimeout(ok, ms))
async function until(fn, label) {
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(`${label}: ${output}`)
    const value = await fn()
    if (value) return value
    await wait(200)
  }
  throw new Error(`Timed out: ${label}\n${output}\nLogs: ${temp}`)
}
let native
let state, electronChild, electronState
try {
  if (shared) {
    const registration = await until(() => {
      try { return JSON.parse(readFileSync(resolve(temp, 'state/opencode/service.json'), 'utf8')) } catch { return null }
    }, 'shared service registration')
    base = registration.url
    password = registration.password || ''
  }
  native = OpenCode.make({ baseUrl: base, headers: { authorization: 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64') } })
  const info = await until(async () => { try { return await native.server.info({ signal: AbortSignal.timeout(1000) }) } catch { return null } }, 'V2 startup')
  assert.match(info.version, /^2\./)
  assert.equal(info.pid, child.pid)
  await native.location.get({ location: { directory: project } })
  state = await until(() => {
    try { const file = readdirSync(states).find(f => f.endsWith('.json')); return file && JSON.parse(readFileSync(resolve(states, file), 'utf8')) } catch { return null }
  }, 'V2 plugin startup')
  assert.equal(state.parentPid, child.pid)
  assert.equal(state.connectionMode, 'v2-http')
  assert.equal(state.serverUrl.replace(/\/$/, ''), base)
  // The runtime writes its ready file before plugin setup receives that state.
  // Wait for the client-visible RPC too, as the real TUI does.
  await until(async () => (await native.rpc(Dashboard).status({}, { location: { directory: project } })).url === state.url, 'dashboard RPC readiness')
  assert.notEqual(state.url, 'http://127.0.0.1:5174')
  async function request(path, method = 'GET', body) {
    const response = await fetch(state.url + path, { method, headers: { 'content-type': 'application/json', 'x-opencode-directory': project }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const text = await response.text()
    assert.equal(response.status, 200, `${method} ${path}: ${text}`)
    return JSON.parse(text)
  }
  assert.equal((await fetch(state.url)).status, 200)
  const health = await request('/health')
  assert.equal(health.service, 'memory-worker-python')
  assert.equal(health.opencodeBase, state.url)
  const session = await request('/session', 'POST', { title: 'V2 smoke' })
  assert.equal(session.directory, project)
  assert.ok((await request('/session')).some(s => s.id === session.id))
  assert.equal((await request(`/session/${session.id}`, 'PATCH', { title: 'Renamed' })).title, 'Renamed')
  assert.deepEqual(await request(`/session/${session.id}/message`), [])
  assert.deepEqual(await request(`/session/${session.id}/todo`), [])
  assert.ok(Array.isArray((await request('/config/providers')).providers))
  assert.ok(Array.isArray(await request('/project')))
  assert.ok(Array.isArray(await request('/permission')))
  assert.ok(Array.isArray(await request('/question')))
  const sse = await fetch(`${state.url}/global/event`, { signal: AbortSignal.timeout(5000) })
  assert.equal(sse.status, 200)
  const reader = sse.body.getReader()
  let frames = ''
  while (!frames.includes('server.connected')) frames += new TextDecoder().decode((await reader.read()).value)
  await request(`/session/${session.id}/message`, 'POST', { parts: [{ type: 'text', text: 'Do not execute this test prompt' }], resume: false })
  assert.equal((await native.session.inbox.list({ sessionID: session.id })).length, 1)
  while (!frames.includes('session.inbox.enqueued')) frames += new TextDecoder().decode((await reader.read()).value)
  await reader.cancel()
  const emptyFork = await fetch(`${state.url}/session/${session.id}/fork`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert.equal(emptyFork.status, 400, 'V2 rejects forking a session with no delivered messages')
  const fixture = await native.session.import({
    info: { ...(await native.session.get({ sessionID: session.id })), id: session.id + 'fixture', title: 'Imported test history' },
    messages: [
      { id: 'msg_vibetraceuser', type: 'user', text: 'Review', time: { created: Date.now() - 2000 } },
      { id: 'msg_vibetraceassistant', type: 'assistant', agent: 'build', model: { providerID: 'test', id: 'test' }, time: { created: Date.now() - 1000, completed: Date.now() }, finish: 'stop', content: [{ type: 'text', text: 'Reviewed' }] },
    ],
  })
  const history = await request(`/session/${fixture.id}/message`)
  assert.equal(history[0].info.role, 'user')
  assert.equal(history[1].parts[0].text, 'Reviewed')
  const fork = await request(`/session/${fixture.id}/fork`, 'POST', {})
  assert.equal(fork.parentID, fixture.id)
  const form = await native.session.form.create({ sessionID: session.id, title: 'Smoke question', fields: [{ type: 'string', key: 'choice', title: 'Choose', options: [{ value: 'yes', label: 'Yes' }] }] })
  assert.ok((await request('/question')).some(q => q.id === form.id))
  await request(`/question/${form.id}/reply`, 'POST', { answers: [['yes']] })
  assert.equal((await native.session.form.get({ sessionID: session.id, formID: form.id })).state.status, 'answered')
  const generation = await request('/session', 'POST', { title: 'Local generation test' })
  await request(`/session/${generation.id}/message`, 'POST', { parts: [{ type: 'text', text: 'Return a local test response' }], model: { providerID: 'vibetrace-test', modelID: 'test' } })
  await until(async () => (await request(`/session/${generation.id}/message`)).find(m => m.info.role === 'assistant' && m.info.finish === 'stop'), 'local provider response')
  assert.equal((await request(`/session/${generation.id}/message`)).find(m => m.info.role === 'assistant').parts.find(p => p.type === 'text').text, 'V2 local response')
  assert.ok(providerCalls > 0)
  await request(`/session/${session.id}/abort`, 'POST', {})
  assert.equal((await fetch(`${state.url}/health`, { headers: { Origin: 'https://example.com' } })).status, 403)
  // Validate the Python backend's own HTTP path, not just the browser adapter.
  const py = spawn('python3', ['-c', `import sys;from pathlib import Path;sys.path.insert(0,${JSON.stringify(resolve(root, 'memory_worker'))});import server;s=server.opencode_create_session(${JSON.stringify(project)});assert server.opencode_get_messages(s['id'])==[];r=Path(${JSON.stringify(resolve(temp, 'python-run'))});r.mkdir();result=server.opencode_generate_text('Test',r,r/'run.log','test',directory=${JSON.stringify(project)},model='vibetrace-test/test');assert 'V2 local response' in result['rawText'];print('worker-api-ok')`], { cwd: root, env: { ...env, VIBETRACE_PLUGIN_MODE: '1', OPENCODE_BASE: state.url, OPENCODE_DIRECTORY: project, VIBETRACE_DATA_DIR: resolve(temp, 'python-data') } })
  let pyOutput = ''
  for (const stream of [py.stdout, py.stderr]) stream.on('data', data => { pyOutput += data })
  const pyStatus = await new Promise((ok, reject) => { py.on('error', reject); py.on('exit', ok) })
  assert.equal(pyStatus, 0, pyOutput)
  assert.match(pyOutput, /worker-api-ok/)
  await request(`/session/${fork.id}`, 'DELETE')
  await request(`/session/${fixture.id}`, 'DELETE')
  await request(`/session/${generation.id}`, 'DELETE')
  await request(`/session/${session.id}`, 'DELETE')
  console.log('PASS: real V2 loads plugin; UI, Python, authenticated API, sessions/create/rename/fork/delete, inbox prompt, live events, model catalog, port conflict and origin checks.')

  if (process.platform !== 'win32') {
    // Launch the actual TUI twice against the same service. Intercept the OS
    // browser command so the test can count requests without opening windows.
    const bin = resolve(temp, 'browser-bin')
    const browserLog = resolve(temp, 'browser-open.log')
    mkdirSync(bin)
    const opener = resolve(bin, process.platform === 'darwin' ? 'open' : 'xdg-open')
    writeFileSync(opener, '#!/usr/bin/env python3\nimport os,sys\nwith open(os.environ["VIBETRACE_BROWSER_LOG"],"a") as f:f.write(sys.argv[1]+"\\n")\n')
    chmodSync(opener, 0o700)
    const script = `import os,pty,select,time,signal,sys
for launch in range(2):
 pid,fd=pty.fork()
 if pid==0:
  os.execvpe('opencode',['opencode','--server',os.environ['VIBETRACE_TEST_SERVER'],os.environ['VIBETRACE_TEST_PROJECT']],os.environ)
 output=b''
 try:
  deadline=time.monotonic()+35
  while time.monotonic()<deadline:
   if os.path.exists(os.environ['VIBETRACE_BROWSER_LOG']):
    if len(open(os.environ['VIBETRACE_BROWSER_LOG']).readlines())>=launch+1:break
   ready,_,_=select.select([fd],[],[],0.1)
   if ready:
    try: output+=os.read(fd,65536)
    except OSError:break
  else:raise RuntimeError('TUI browser-open timeout: '+output[-4000:].decode(errors='replace'))
  assert len(open(os.environ['VIBETRACE_BROWSER_LOG']).readlines())==launch+1,output[-4000:]
 finally:
  try:os.kill(pid,signal.SIGTERM)
  except ProcessLookupError:pass
  for _ in range(30):
   if os.waitpid(pid,os.WNOHANG)[0]:break
   time.sleep(0.1)
  else:
   os.kill(pid,signal.SIGKILL);os.waitpid(pid,0)
  os.close(fd)
print('tui-browser-open-ok')
`
    const tuiEnv = { ...env, PATH: bin + ':' + process.env.PATH, TERM: 'xterm-256color', OPENCODE_PASSWORD: password, VIBETRACE_BROWSER_LOG: browserLog, VIBETRACE_TEST_SERVER: base, VIBETRACE_TEST_PROJECT: project }
    delete tuiEnv.VIBETRACE_NO_BROWSER
    const tui = spawn('python3', ['-c', script], { cwd: project, env: tuiEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    let tuiOutput = ''
    for (const stream of [tui.stdout, tui.stderr]) stream.on('data', data => { tuiOutput += data })
    const code = await new Promise((ok, reject) => { tui.on('error', reject); tui.on('exit', ok) })
    assert.equal(code, 0, tuiOutput)
    assert.deepEqual(readFileSync(browserLog, 'utf8').trim().split('\n'), [state.url + '/', state.url + '/'])
    console.log('PASS: two real terminal launches reuse one V2 service and each request the browser exactly once.')
  }

  const electron = process.env.VIBETRACE_TEST_ELECTRON || '/Applications/OpenCode.app/Contents/MacOS/OpenCode'
  if (existsSync(electron)) {
    const electronStates = resolve(temp, 'electron-runtime')
    electronChild = spawn(electron, ['--input-type=module', '-e', `
      import { ensureRuntime } from ${JSON.stringify(new URL('../plugins/launcher.mjs', import.meta.url).href)};
      if (!process.versions.electron) throw new Error('Expected Electron host');
      setInterval(() => {}, 1000);
      await ensureRuntime({ serverUrl: new URL(${JSON.stringify(base)}), directory: ${JSON.stringify(project)}, vibetraceAuth: { username: 'opencode', password: ${JSON.stringify(password)} }, vibetraceConnectionMode: 'v2-http' });
    `], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, ELECTRON_RUN_AS_NODE: '1', VIBETRACE_RUNTIME_DIR: electronStates } })
    electronChild.stdout.on('data', data => { output += data })
    electronChild.stderr.on('data', data => { output += data })
    electronState = await until(() => {
      if (electronChild.exitCode !== null) throw new Error(output)
      try { const file = readdirSync(electronStates).find(f => f.endsWith('.json')); return file && JSON.parse(readFileSync(resolve(electronStates, file), 'utf8')) } catch { return null }
    }, 'Electron launcher')
    assert.equal((await fetch(`${electronState.url}/session`)).status, 200)
    console.log('PASS: actual Electron host launches Node/Python and connects to V2.')
  }
} finally {
  electronChild?.kill('SIGTERM')
  child.kill('SIGTERM')
  provider.close()
  if (ownsBlocker) blocker.close()
  await wait(5000)
  for (const runtime of [state, electronState].filter(Boolean)) {
    let alive = true
    try { await fetch(`${runtime.url}/health`, { signal: AbortSignal.timeout(500) }) } catch { alive = false }
    assert.equal(alive, false, 'VibeTrace exits with its owner')
  }
}
