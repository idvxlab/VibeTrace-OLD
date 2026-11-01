#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { root, runtimeDir, pythonExecutable, nodeExecutable, liveState, openBrowser } from '../plugins/launcher.mjs'
import { findNode, findPython } from '../plugins/environment.mjs'

function runOpenCode(args, options = {}) {
  // npm-installed OpenCode can be a .cmd shim on Windows. Only fixed commands
  // and the package's own validated name/version are passed to this shell.
  return spawnSync('opencode', args, { windowsHide: true, shell: process.platform === 'win32', ...options })
}

function inspectEnvironment() {
  const checks = []
  for (const [name, find] of [['Node.js', findNode], ['Python', findPython]]) {
    try { checks.push({ name, ok: true, ...find() }) }
    catch (error) { checks.push({ name, ok: false, message: error.message }) }
  }
  const result = runOpenCode(['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })
  const version = result.stdout?.replace(/\x1b\[[0-9;]*m/g, '').match(/\bv?(\d+\.\d+\.\d+(?:-[\w.-]+)?)/)?.[1]
  checks.push({ name: 'OpenCode', ok: result.status === 0 && !!version?.startsWith('2.'), ...(version ? { version } : {}),
    ...(result.status !== 0 || !version?.startsWith('2.') ? { message: 'OpenCode V2 is required (tested with 2.1.4). Install V2 from https://opencode.ai/v2/docs/ and reopen your terminal.' } : {}) })
  return { ok: checks.every(check => check.ok), platform: process.platform, checks,
    note: 'This checks local executables only; it does not test your model credentials or start OpenCode services.' }
}

function showEnvironment(report) {
  if (process.argv.includes('--json')) return console.log(JSON.stringify(report, null, 2))
  console.log(`VibeTrace environment check (${report.platform})`)
  for (const check of report.checks) {
    console.log(`${check.ok ? 'OK' : 'MISSING'}: ${check.name}${check.version ? ` ${check.version}` : ''}${check.path ? ` — ${check.path}` : ''}`)
    if (!check.ok) console.log(check.message)
  }
  console.log(report.note)
}

const command = process.argv[2] || 'status'
const targetIndex = process.argv.indexOf('--plugin-dir')
if (targetIndex >= 0 && (!process.argv[targetIndex + 1] || process.argv[targetIndex + 1].startsWith('--'))) throw new Error('--plugin-dir requires a directory')
const pluginDir = targetIndex >= 0 ? resolve(process.argv[targetIndex + 1]) : resolve(process.env.XDG_CONFIG_HOME || resolve(homedir(), '.config'), 'opencode/plugins')
const legacyWrapper = resolve(pluginDir, 'vibetrace.js')
const packageDir = resolve(pluginDir, 'vibetrace')
const wrapper = resolve(packageDir, 'index.js')
const manifest = resolve(packageDir, 'package.json')
const marker = '// Managed by VibeTrace local installer\n'
let proceed = true
if (command === 'doctor' || command === 'setup') {
  const report = inspectEnvironment()
  showEnvironment(report)
  if (!report.ok) { process.exitCode = 1; proceed = false }
  else if (command === 'setup' && !process.argv.includes('--local')) {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    if (pkg.name !== '@xiaokeyan/opencode-v2-vibetrace' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)) throw new Error('Unexpected package identity')
    const result = runOpenCode(['plugin', 'add', `${pkg.name}@${pkg.version}`], { stdio: 'inherit' })
    if (result.error || result.status !== 0) {
      console.error('VibeTrace registration failed. The requested version must be published on npm. Check the error above; no system runtime was installed.')
      process.exitCode = 1
    } else console.log('VibeTrace registered. Fully restart OpenCode, then open a project in the terminal. This beta targets the V2 terminal client.')
  }
}
if (proceed && (command === 'install' || command === 'setup' && process.argv.includes('--local'))) {
  const runtimes = { python: pythonExecutable(), node: nodeExecutable() }
  if (!existsSync(resolve(root, 'dist/.vibetrace-plugin-build'))) throw new Error('First run npm run build:plugin')
  if (existsSync(packageDir) && (!existsSync(manifest) || JSON.parse(readFileSync(manifest, 'utf8')).vibetraceManaged !== true)) throw new Error(`Refusing to overwrite unrelated directory: ${packageDir}`)
  if (existsSync(legacyWrapper) && !readFileSync(legacyWrapper, 'utf8').startsWith(marker)) throw new Error(`Refusing to overwrite unrelated file: ${legacyWrapper}`)
  if (existsSync(wrapper) && !readFileSync(wrapper, 'utf8').startsWith(marker)) throw new Error(`Refusing to overwrite unrelated file: ${wrapper}`)
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(manifest, JSON.stringify({ name: '@xiaokeyan/opencode-v2-vibetrace-local', type: 'module', vibetraceManaged: true, exports: { '.': './index.js', './server': './index.js', './tui': './tui.js' } }, null, 2) + '\n')
  writeFileSync(wrapper, marker + `import plugin from ${JSON.stringify(pathToFileURL(resolve(root, 'plugins/vibetrace.mjs')).href)};\nexport default { id: plugin.id, setup: ctx => plugin.setup({ ...ctx, options: { ...ctx.options, ...${JSON.stringify(runtimes)} } }) };\n`)
  writeFileSync(resolve(packageDir, 'tui.js'), marker + `export { default } from ${JSON.stringify(pathToFileURL(resolve(root, 'tui.js')).href)};\n`)
  if (existsSync(legacyWrapper)) unlinkSync(legacyWrapper)
  console.log(`Installed local link: ${wrapper}\nSource: ${root}\nRestart OpenCode and open a project. Keep this source directory in place.`)
} else if (proceed && command === 'uninstall') {
  if (existsSync(packageDir)) {
    if (!existsSync(manifest) || JSON.parse(readFileSync(manifest, 'utf8')).vibetraceManaged !== true) throw new Error('This directory was not installed by VibeTrace')
    const files = [wrapper, resolve(packageDir, 'tui.js')]
    for (const file of files) if (existsSync(file) && !readFileSync(file, 'utf8').startsWith(marker)) throw new Error('Refusing to remove an unrelated file')
    for (const file of [...files, manifest]) if (existsSync(file)) unlinkSync(file)
    if (!readdirSync(packageDir).length) rmdirSync(packageDir)
  }
  if (existsSync(legacyWrapper)) {
    if (!readFileSync(legacyWrapper, 'utf8').startsWith(marker)) throw new Error('This file was not installed by VibeTrace')
    unlinkSync(legacyWrapper)
  }
  console.log('Local plugin link removed. Restart OpenCode to unload it. Data is preserved.')
} else if (proceed && (command === 'status' || command === 'open' || command === 'stop')) {
  console.log(`Source: ${root}\nPlugin link: ${existsSync(wrapper) ? wrapper : 'not installed'}\nRuntime directory: ${runtimeDir}`)
  if (existsSync(wrapper)) {
    const entry = readFileSync(wrapper, 'utf8')
    console.log(`Registered source: ${entry.match(/import plugin from "([^"]+)"/)?.[1] || 'unrecognized entry'}`)
  }
  const states = []
  for (const file of existsSync(runtimeDir) ? readdirSync(runtimeDir) : []) {
    if (!file.endsWith('.json')) continue
    const state = await liveState(resolve(runtimeDir, file))
    if (state) states.push(state)
  }
  for (const state of states) console.log(`Running: ${state.url} → OpenCode ${state.serverUrl} [${state.connectionMode || 'unknown'}] (parent ${state.parentPid})`)
  if (!states.length) console.log('No managed VibeTrace service running. Start OpenCode and open a project.')
  if (command === 'open') states.forEach(state => openBrowser(state.url))
  if (command === 'stop') {
    for (const state of states) process.kill(state.pid, 'SIGTERM')
    if (states.length) console.log(`Stopping ${states.length} managed VibeTrace service(s). OpenCode itself remains open.`)
  }
} else if (!['doctor', 'setup'].includes(command)) throw new Error('Usage: vibetrace doctor [--json] | setup [--local] | install|uninstall|status|open|stop [--plugin-dir DIRECTORY]')
