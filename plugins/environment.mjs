import { execFileSync } from 'node:child_process'

export function installationHelp(platform = process.platform) {
  if (platform === 'win32') return [
    'Windows PowerShell or Command Prompt:',
    '  winget install --exact --id OpenJS.NodeJS.LTS',
    '  winget install --exact --id Python.Python.3.13',
    'If winget is unavailable, use https://nodejs.org/en/download and https://www.python.org/downloads/windows/.',
  ].join('\n')
  if (platform === 'darwin') return [
    'macOS, if Homebrew is installed:',
    '  brew install node python',
    'Otherwise use https://nodejs.org/en/download and https://www.python.org/downloads/macos/.',
  ].join('\n')
  return 'Install Node.js 20+ and Python 3.9+ with your system package manager. See https://nodejs.org/en/download and https://www.python.org/downloads/.'
}

function missingRuntime(name, requirement, tried, platform) {
  const error = new Error([
    `VibeTrace could not find a working ${name} (${requirement}).`,
    `Tried: ${tried.join(', ')}.`,
    installationHelp(platform),
    'After installing, open a new terminal and fully restart OpenCode.',
    'For an existing installation, set PYTHON or VIBETRACE_NODE to its absolute executable path, or use plugin options python/node.',
    'VibeTrace does not automatically install system runtimes.',
  ].join('\n'))
  error.code = 'VIBETRACE_ENVIRONMENT'
  return error
}

const probeOptions = { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }

export function findPython(configured, { platform = process.platform, env = process.env, run = execFileSync } = {}) {
  const explicit = configured || env.PYTHON
  const candidates = explicit ? [[explicit, []]] : platform === 'win32'
    ? [['python', []], ['py', ['-3']], ['python3', []]]
    : [['python3', []], ['python', []]]
  for (const [command, prefix] of candidates) {
    try {
      const result = JSON.parse(run(command, [...prefix, '-c', [
        'import sys,json,http.server,urllib.request,sqlite3',
        'print(json.dumps({"path":sys.executable,"version":list(sys.version_info[:3])}))',
      ].join(';')], { ...probeOptions, env: { ...env, PYTHON_MANAGER_AUTOMATIC_INSTALL: 'false' } }).trim())
      if (typeof result.path !== 'string' || !result.path.trim() || !Array.isArray(result.version) ||
          !(result.version[0] > 3 || result.version[0] === 3 && result.version[1] >= 9)) continue
      return { path: result.path, version: result.version.join('.') }
    } catch { /* Try the next interpreter; an explicit override never silently falls back. */ }
  }
  throw missingRuntime('Python', 'Python 3.9+', candidates.map(([cmd, args]) => [cmd, ...args].join(' ')), platform)
}

export function findNode(configured, host = process, { run = execFileSync } = {}) {
  const platform = host.platform || process.platform
  const env = host.env || process.env
  const explicit = configured || env.VIBETRACE_NODE
  const candidates = explicit ? [explicit] : [...new Set([
    ...(!host.versions.bun && !host.versions.electron && host.execPath ? [host.execPath] : []), 'node',
  ])]
  for (const command of candidates) {
    try {
      const result = JSON.parse(run(command, ['-p', 'JSON.stringify({path:process.execPath,node:process.versions.node,electron:!!process.versions.electron,bun:!!process.versions.bun})'], probeOptions).trim())
      if (typeof result.path !== 'string' || !result.path.trim() || result.electron || result.bun || !(Number(result.node?.split('.')[0]) >= 20)) continue
      return { path: result.path, version: result.node }
    } catch { /* A desktop helper is not a standalone Node executable. */ }
  }
  throw missingRuntime('Node.js', 'standalone Node.js 20+', candidates, platform)
}
