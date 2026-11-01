import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, delimiter } from 'node:path'
import { spawnSync } from 'node:child_process'
import { findPython, findNode, installationHelp } from '../plugins/environment.mjs'

test('Windows finds py -3 after a broken python alias and pins the interpreter, including spaces', () => {
  const calls = []
  const result = findPython(undefined, { platform: 'win32', env: {}, run(command, args, options) {
    calls.push([command, args])
    assert.equal(options.timeout, 5000)
    assert.equal(options.windowsHide, true)
    assert.equal(options.env.PYTHON_MANAGER_AUTOMATIC_INSTALL, 'false')
    if (command === 'python') throw new Error('Microsoft Store alias')
    assert.equal(command, 'py')
    assert.deepEqual(args.slice(0, 2), ['-3', '-c'])
    return JSON.stringify({ path: 'C:\\Users\\Test User\\Python\\python.exe', version: [3, 13, 1] })
  } })
  assert.equal(result.path, 'C:\\Users\\Test User\\Python\\python.exe')
  assert.equal(calls.length, 2)
})

test('Unix skips an old Python and tries python; invalid explicit paths never fall back', () => {
  const calls = []
  const result = findPython(undefined, { platform: 'darwin', env: {}, run(command) {
    calls.push(command)
    return JSON.stringify({ path: command, version: command === 'python3' ? [3, 8, 10] : [3, 12, 0] })
  } })
  assert.equal(result.path, 'python')
  assert.deepEqual(calls, ['python3', 'python'])
  const explicit = []
  assert.throws(() => findPython('/missing/custom python', { platform: 'win32', env: {}, run(command) {
    explicit.push(command)
    throw new Error('missing')
  } }), error => error.code === 'VIBETRACE_ENVIRONMENT' && /winget install/.test(error.message))
  assert.deepEqual(explicit, ['/missing/custom python'])
})

test('desktop hosts reject their own executable and probe standalone Node', () => {
  const calls = []
  const host = { versions: { electron: '1' }, execPath: '/desktop-helper', platform: 'darwin', env: {} }
  const result = findNode(undefined, host, { run(command) {
    calls.push(command)
    return JSON.stringify({ path: '/node', node: '22.0.0', electron: false, bun: false })
  } })
  assert.equal(result.path, '/node')
  assert.deepEqual(calls, ['node'])
  assert.throws(() => findNode('/bad-node', host, { run: () => JSON.stringify({ path: '/bad-node', node: '18.0.0' }) }), /Node.js 20\+/)
  assert.match(installationHelp('darwin'), /brew install node python/)
  assert.match(installationHelp('win32'), /Python.Python.3.13/)
})

// Real subprocess tests stay in temporary folders and intercept OpenCode.
// Windows needs native runner coverage for .cmd and PowerShell execution.
test('doctor/setup validate before registration, preserve failures, and install local links with spaces', { skip: process.platform === 'win32' }, () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'vibetrace-installer-'))
  const bin = resolve(temp, 'bin with spaces')
  const config = resolve(temp, 'config')
  const marker = resolve(temp, 'registered.json')
  mkdirSync(bin)
  const command = resolve(bin, 'opencode')
  writeFileSync(command, `#!${process.execPath}\nif(process.argv[2]==='--version'){console.log(process.env.TEST_OPENCODE_VERSION||'opencode v2.1.4')}else{require('node:fs').writeFileSync(process.env.TEST_REGISTRATION,JSON.stringify(process.argv.slice(2)));process.exit(Number(process.env.TEST_REGISTER_EXIT||0))}\n`)
  chmodSync(command, 0o700)
  const env = { ...process.env, PATH: bin + delimiter + process.env.PATH, XDG_CONFIG_HOME: config, TEST_REGISTRATION: marker }
  delete env.VIBETRACE_NODE
  delete env.PYTHON
  const cli = resolve('scripts/vibetrace.mjs')
  const run = (args, overrides = {}) => spawnSync(process.execPath, [cli, ...args], { env: { ...env, ...overrides }, encoding: 'utf8' })
  const doctor = run(['doctor', '--json'])
  assert.equal(doctor.status, 0, doctor.stderr + doctor.stdout)
  const report = JSON.parse(doctor.stdout)
  assert.equal(report.ok, true)
  assert.equal(report.checks.length, 3)
  assert.equal(report.checks.find(x => x.name === 'Python').ok, true)
  assert.equal(run(['doctor', '--json'], { TEST_OPENCODE_VERSION: 'opencode 1.19.4' }).status, 1)
  const invalid = run(['setup'], { PYTHON: '/missing/explicit-python' })
  assert.equal(invalid.status, 1)
  assert.match(invalid.stdout, /MISSING: Python/)
  const registered = run(['setup'])
  assert.equal(registered.status, 0, registered.stderr + registered.stdout)
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), ['plugin', 'add', `${pkg.name}@${pkg.version}`])
  const failed = run(['setup'], { TEST_REGISTER_EXIT: '7' })
  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /registration failed/)
  const local = run(['setup', '--local', '--plugin-dir', resolve(config, 'my plugins')])
  assert.equal(local.status, 0, local.stderr + local.stdout)
  const entry = readFileSync(resolve(config, 'my plugins/vibetrace/index.js'), 'utf8')
  assert.match(entry, /Managed by VibeTrace local installer/)
  assert.match(entry, /"python":/)
  assert.match(entry, /"node":/)
  const shell = spawnSync('sh', [resolve('scripts/install.sh')], { env, encoding: 'utf8' })
  assert.equal(shell.status, 0, shell.stderr + shell.stdout)
})
