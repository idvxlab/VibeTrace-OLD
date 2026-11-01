import { OpenCode } from '@opencode/client'

// VibeTrace's UI and worker share this private data contract. Only this boundary
// speaks OpenCode V2; these routes are not requests to a V1 server.
export function normalizeSession(session) {
  return { ...session, parentID: session.parentID || session.fork?.sessionID, slug: session.id, directory: session.location?.directory || '',
    title: session.title || 'New session', version: '2',
    summary: { additions: 0, deletions: 0, files: 0 } }
}

function textContent(content = []) {
  return content.filter(p => p.type === 'text').map(p => p.text).join('\n')
}

export function normalizeMessages(messages, sessionID) {
  const result = []
  let parentID
  for (const message of messages) {
    if (!['user', 'assistant', 'synthetic', 'compaction'].includes(message.type)) continue
    const role = ['user', 'synthetic'].includes(message.type) ? 'user' : 'assistant'
    const info = { ...message, role, sessionID, parentID,
      model: message.model ? { ...message.model, modelID: message.model.id } : undefined }
    delete info.content
    let content = message.content || []
    if (role === 'user') {
      content = [{ type: 'text', text: message.text || '' }, ...(message.files || []).map(f => ({ type: 'file', url: f.uri, filename: f.name }))]
      parentID = message.id
    } else if (message.type === 'compaction') {
      content = [{ type: 'compaction', auto: message.reason === 'auto' },
        ...(message.summary ? [{ type: 'text', text: message.summary }] : [])]
      info.summary = true
    }
    const parts = content.map((part, index) => {
      const common = { id: part.id || `${message.id}:${index}`, sessionID, messageID: message.id }
      if (part.type !== 'tool') return { ...part, ...common }
      const state = part.state || {}
      return { type: 'tool', ...common, callID: part.id, tool: part.name,
        state: { ...state, status: state.status === 'streaming' ? 'pending' : state.status,
          output: state.content ? textContent(state.content) : undefined,
          error: state.error ? (typeof state.error === 'string' ? state.error : state.error.message || JSON.stringify(state.error)) : undefined,
          time: { start: part.time?.ran || part.time?.created, end: part.time?.completed },
        } }
    })
    result.push({ info, parts })
  }
  return result
}

export function normalizeForm(form) {
  return { id: form.id, sessionID: form.sessionID,
    questions: form.fields.map(field => ({ header: field.title || form.title,
      question: field.description || field.title || field.key,
      options: (field.options || (field.type === 'boolean' ? [{ value: 'true' }, { value: 'false' }] : [])).map(o => ({ label: o.value, description: o.label || o.description || o.value })),
      multiple: field.type === 'multiselect', custom: field.custom !== false,
    })) }
}

export function normalizeEvent(event) {
  let type = event.type
  const data = event.data || {}
  let properties = data
  if (type === 'form.created') { type = 'question.asked'; properties = normalizeForm(data.form) }
  if (type === 'form.replied' || type === 'form.cancelled') {
    type = type === 'form.replied' ? 'question.replied' : 'question.rejected'
    properties = { ...data, requestID: data.formID }
  }
  if (type === 'permission.replied') properties = { ...data, reply: data.reply || data.decision }
  if (type.startsWith('session.compaction.')) type = type.replace('session.compaction.', 'session.next.compaction.')
  return { directory: event.location?.directory, payload: { type, properties, data, created: event.created } }
}

async function readBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 16 * 1024 * 1024) throw Object.assign(new Error('Request too large'), { status: 413 })
  }
  return body ? JSON.parse(body) : {}
}

export function createV2Api(config) {
  const client = OpenCode.make({ baseUrl: config.serverUrl,
    headers: config.password ? { authorization: 'Basic ' + Buffer.from(`opencode:${config.password}`).toString('base64') } : {} })
  async function allPages(load) {
    const rows = []
    let cursor
    do {
      const page = await load(cursor)
      rows.push(...page.data)
      const next = page.cursor?.next
      if (next && next === cursor) throw new Error('OpenCode returned a repeated pagination cursor')
      cursor = next || undefined
    } while (cursor)
    return rows
  }
  const sessions = (filters = {}) => allPages(cursor => client.session.list(cursor ? { cursor, limit: 100 } : { ...filters, limit: 100, order: 'asc' }))
  const messages = sessionID => allPages(cursor => client.message.list({ sessionID, limit: 100, ...(cursor ? { cursor } : { order: 'asc' }) }))
  const forms = async location => (await client.form.list({ location })).data
  const permissions = async location => (await client.permission.request.list({ location })).data
  async function findRequest(id, list) {
    const item = (await list()).find(item => item.id === id)
    if (!item) throw Object.assign(new Error('Pending request not found'), { status: 404 })
    return item
  }
  async function route(req, url, body) {
    const path = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const method = req.method
    const directory = req.headers['x-opencode-directory'] || url.searchParams.get('directory') || config.directory
    const location = { directory }
    if (path[0] === 'session' && path.length === 1) {
      if (method === 'POST') return normalizeSession(await client.session.create({ ...body, location }))
      const filters = {}
      if (url.searchParams.get('directory')) filters.directory = url.searchParams.get('directory')
      if (url.searchParams.get('roots') === 'true') filters.parentID = null
      if (url.searchParams.get('search')) filters.search = url.searchParams.get('search')
      return (await sessions(filters)).map(normalizeSession)
    }
    if (path[0] === 'session' && path[1] === 'status') {
      const active = await client.session.active()
      return Object.fromEntries(Object.entries(active).map(([id, state]) => [id, state.status || { type: 'busy' }]))
    }
    if (path[0] === 'session' && path[1]) {
      const sessionID = path[1]
      if (path.length === 2) {
        if (method === 'DELETE') { await client.session.remove({ sessionID }); return true }
        if (method === 'PATCH') { await client.session.update({ sessionID, ...body }); return normalizeSession(await client.session.get({ sessionID })) }
        return normalizeSession(await client.session.get({ sessionID }))
      }
      if (path[2] === 'message') {
        if (method === 'GET') return normalizeMessages(await messages(sessionID), sessionID)
        if (body.model) await client.session.switchModel({ sessionID, model: { providerID: body.model.providerID, id: body.model.modelID || body.model.id } })
        if (body.agent) await client.session.switchAgent({ sessionID, agent: body.agent })
        const files = (body.parts || []).flatMap(p => {
          if (p.type === 'image') return [{ uri: `data:${p.source.media_type};base64,${p.source.data}` }]
          if (p.type === 'file') return [{ uri: p.url, name: p.filename }]
          return []
        })
        return client.session.prompt({ sessionID, text: textContent(body.parts), ...(files.length ? { files } : {}),
          ...(body.resume === false ? { resume: false } : {}) })
      }
      if (path[2] === 'abort') { await client.session.interrupt({ sessionID }); return true }
      if (path[2] === 'fork') return normalizeSession(await client.session.fork({ sessionID, ...(body.messageID ? { before: body.messageID } : {}) }))
      if (path[2] === 'todo') {
        // V2 todos are experimental tools, not a separate session endpoint.
        const rows = normalizeMessages(await messages(sessionID), sessionID)
        const tools = rows.flatMap(m => m.parts).filter(p => p.type === 'tool' && /todo/i.test(p.tool) && p.state.status === 'completed')
        return tools.at(-1)?.state.input?.todos || []
      }
    }
    if (path[0] === 'project') {
      if (path[1] === 'current') return (await client.location.get({ location })).project
      return (await client.project.list()).map(p => ({ ...p, worktree: p.canonical || p.directory }))
    }
    if (path[0] === 'path') return { directory, worktree: directory }
    if (url.pathname === '/config/providers') {
      const [providers, models, selected] = await Promise.all([client.provider.list({ location }), client.model.list({ location }), client.model.default({ location })])
      return { providers: providers.data.map(provider => ({ ...provider,
        models: Object.fromEntries(models.data.filter(m => m.providerID === provider.id && m.enabled).map(m => [m.id, { ...m, cost: m.cost[0] || {} }])) })),
        default: selected.data ? { [selected.data.providerID]: selected.data.id } : {} }
    }
    if (path[0] === 'agent') return (await client.agent.list({ location })).data
    if (path[0] === 'permission') {
      if (path.length === 1) return permissions(location)
      const item = await findRequest(path[1], () => permissions(location))
      await client.permission.reply({ sessionID: item.sessionID, requestID: item.id, decision: body.reply, ...(body.message ? { message: body.message } : {}) })
      return true
    }
    if (path[0] === 'question') {
      if (path.length === 1) return (await forms(location)).map(normalizeForm)
      const form = await findRequest(path[1], () => forms(location))
      if (path[2] === 'reject') await client.session.form.cancel({ sessionID: form.sessionID, formID: form.id })
      else {
        const answer = Object.fromEntries(form.fields.map((field, i) => {
          const values = body.answers?.[i] || []
          let value = values[0] ?? ''
          if (field.type === 'multiselect') value = values
          else if (field.type === 'boolean') value = value === 'true'
          else if (field.type === 'number' || field.type === 'integer') {
            if (!String(value).trim() || !Number.isFinite(Number(value))) throw Object.assign(new Error('A numeric answer is required'), { status: 400 })
            value = Number(value)
          } else if (field.type !== 'string') throw Object.assign(new Error(`Unsupported form field: ${field.type}. Reply in OpenCode.`), { status: 422 })
          return [field.key, value]
        }))
        await client.session.form.reply({ sessionID: form.sessionID, formID: form.id, answer })
      }
      return true
    }
    throw Object.assign(new Error(`Unsupported VibeTrace route: ${method} ${url.pathname}`), { status: 404 })
  }
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const abort = new AbortController()
    res.on('close', () => abort.abort())
    if (url.pathname === '/global/event') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      res.write(': connected\n\n')
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000)
      res.on('close', () => clearInterval(heartbeat))
      try {
        for await (const event of client.event.subscribe({ signal: abort.signal })) {
          if (!res.write(`data: ${JSON.stringify(normalizeEvent(event))}\n\n`)) {
            // Reconnect and resync instead of accumulating an unbounded queue.
            res.end(); break
          }
        }
      } catch { /* client reconnects and refreshes after an interrupted stream */ }
      finally { clearInterval(heartbeat); res.end() }
      return
    }
    try {
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {}
      const data = await route(req, url, body)
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data))
    } catch (error) {
      const status = error.status || (error._tag?.includes('NotFound') ? 404 : error._tag === 'InvalidRequestError' ? 400 : 502)
      res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message || String(error) }))
    }
  }
}
