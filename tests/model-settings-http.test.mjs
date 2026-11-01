import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { handleModelConfigRequest } from '../plugins/model-config-http.mjs'

test('dashboard model settings save locally and allow clearing the skill override', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'vibetrace-settings-http-'))
  const request = async (method, body) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)])
    req.method = method
    const res = {
      status: 0, body: '',
      writeHead(status) { this.status = status },
      end(payload) { this.body = payload },
    }
    await handleModelConfigRequest(req, res, resolve(dir, 'service.json'))
    return { status: res.status, body: JSON.parse(res.body) }
  }
  assert.deepEqual((await request('GET')).body, { backgroundModel: '', skillEvolutionModel: '' })
  const saved = await request('PUT', { backgroundModel: 'provider/analysis', skillEvolutionModel: 'provider/skill' })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.body, { backgroundModel: 'provider/analysis', skillEvolutionModel: 'provider/skill' })
  assert.equal((await request('PUT', { backgroundModel: 'invalid' })).status, 400)
  assert.deepEqual((await request('PUT', { skillEvolutionModel: null })).body, { backgroundModel: 'provider/analysis', skillEvolutionModel: '' })
  assert.equal(JSON.parse(readFileSync(resolve(dir, 'config.json'), 'utf8')).backgroundModel, 'provider/analysis')
})
