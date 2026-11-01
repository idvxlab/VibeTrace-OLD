import { define } from '@opencode/plugin/tui/plugin'
import { Dashboard } from './dashboard-rpc.mjs'
import { openBrowser } from './launcher.mjs'

export function setup(ctx, { open = openBrowser, interval = 500, attempts = 60 } = {}) {
  if (process.env.VIBETRACE_NO_BROWSER === '1') return
  // This state belongs to this TUI process, not the long-lived server. It also
  // prevents config reconciliation/hot reload from opening duplicate tabs.
  const [state, update] = ctx.storage.memory('dashboard-browser', { initial: { opened: false } })
  if (state.opened) return
  let cancelled = false
  const abort = new AbortController()
  const status = ctx.client.rpc(Dashboard)
  void (async () => {
    let lastError
    for (let attempt = 0; attempt < attempts && !cancelled; attempt++) {
      try {
        const result = await status.status({}, { location: ctx.location, signal: abort.signal })
        if (cancelled) return
        if (result.url) {
          const url = new URL(result.url)
          if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Unsupported VibeTrace dashboard URL')
          update(value => { value.opened = true })
          open(url.href)
          return
        }
      } catch (error) { lastError = error }
      await new Promise(ok => setTimeout(ok, interval))
    }
    if (!cancelled) ctx.ui.toast.show({ title: 'VibeTrace', message: lastError?.message || 'Dashboard is still starting. Check VibeTrace status.', variant: 'warning' })
  })()
  return () => { cancelled = true; abort.abort() }
}

export default define({ id: 'vibetrace', setup })
