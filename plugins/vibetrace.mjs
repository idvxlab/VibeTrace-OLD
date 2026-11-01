import { Plugin } from '@opencode/plugin'
import { OpenCode } from '@opencode/client'
import { Service } from '@opencode/client/service'
import { ensureRuntime } from './launcher.mjs'
import { Dashboard } from './dashboard-rpc.mjs'

const owners = new Map()
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function resolveServer(options = {}) {
  const explicit = options.serverUrl || process.env.VIBETRACE_OPENCODE_URL
  const endpoint = explicit ? {
    url: explicit,
    auth: { password: options.password || process.env.OPENCODE_PASSWORD || process.env.OPENCODE_SERVER_PASSWORD || '' },
  } : await Service.discover({ version: version => version.startsWith('2.') })
  if (!endpoint) throw new Error('VibeTrace is waiting for the local OpenCode V2 service. For a standalone server, set VIBETRACE_OPENCODE_URL to its URL.')
  const url = new URL(endpoint.url)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('VibeTrace requires a local HTTP OpenCode V2 server')
  const password = endpoint.auth?.password || decodeURIComponent(url.password)
  url.username = ''; url.password = ''
  const client = OpenCode.make({ baseUrl: url.href, headers: password ? { authorization: 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64') } : {} })
  const info = await client.server.info({ signal: AbortSignal.timeout(2000) })
  // Never accidentally attach a plugin to another running installation.
  if (info.pid !== process.pid) throw new Error('Discovered OpenCode server does not belong to this plugin process')
  return { serverUrl: url, vibetraceAuth: { username: 'opencode', password }, vibetraceConnectionMode: 'v2-http' }
}

export async function setup(ctx) {
  if (!ctx.app?.version?.startsWith('2.')) throw new Error('This VibeTrace release requires OpenCode V2')
  const options = ctx.options || {}
  let cancelled = false
  let state
  await ctx.rpc.register(Dashboard, { status: async () => ({ url: state?.url || null }) })
  // Service registration can become available only after plugin setup returns.
  const startup = (async () => {
    let lastError
    for (let attempt = 0; attempt < 30 && !cancelled; attempt++) {
      try {
        const connection = await resolveServer(options)
        if (cancelled) return
        state = await ensureRuntime({ ...connection, directory: ctx.location.directory }, options)
        if (cancelled) {
          if (!owners.has(state.pid)) { try { process.kill(state.pid, 'SIGTERM') } catch {} }
          return
        }
        owners.set(state.pid, (owners.get(state.pid) || 0) + 1)
        console.info(`[VibeTrace] ready: ${state.url}`)
        return
      } catch (error) {
        lastError = error
        // Missing prerequisites will not improve by retrying the same probe 30 times.
        if (error.code === 'VIBETRACE_ENVIRONMENT') break
        await delay(500)
      }
    }
    if (!cancelled) console.error('[VibeTrace] startup failed:', lastError?.message)
  })()
  return async () => {
    cancelled = true
    await startup
    if (!state || !owners.has(state.pid)) return
    const count = owners.get(state.pid) - 1
    if (count > 0) owners.set(state.pid, count)
    else {
      owners.delete(state.pid)
      try { process.kill(state.pid, 'SIGTERM') } catch {}
    }
  }
}

export default Plugin.define({ id: 'vibetrace', setup })
