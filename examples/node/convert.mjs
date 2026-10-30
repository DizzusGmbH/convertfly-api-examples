// Convert a local file with the ConvertFly API (Node.js 18+, no dependencies).
//
// Usage:
//   export CONVERTFLY_API_KEY=cvfly_sk_...
//   node convert.mjs photo.png pdf

import { readFile, writeFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

const API = 'https://convertfly.io/api/v1'
const key = process.env.CONVERTFLY_API_KEY
const [path, outputFormat] = process.argv.slice(2)
if (!key || !path || !outputFormat) {
  console.error('usage: CONVERTFLY_API_KEY=... node convert.mjs <file> <output_format>')
  process.exit(1)
}

const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(method, url, body) {
  const res = await fetch(`${API}${url}`, { method, headers, body: body && JSON.stringify(body) })
  if (!res.ok) throw new Error(`${method} ${url}: HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

const tasksByName = (job) =>
  Array.isArray(job.tasks) ? Object.fromEntries(job.tasks.map((t) => [t.name, t])) : job.tasks ?? {}

const name = basename(path)
const { size } = await stat(path)

// 1. Create a job: upload -> convert -> export.
const job = await api('POST', '/jobs', {
  tasks: {
    upload: { operation: 'import/upload', filename: name, file_size: size },
    convert: { operation: 'convert', input: 'upload', output_format: outputFormat },
    export: { operation: 'export/url', input: 'convert' },
  },
})

// 2. Wait for the upload URL, send the file, then confirm the upload.
let uploadTask, upload
for (let i = 0; i < 60 && !upload?.url; i++) {
  uploadTask = tasksByName(await api('GET', `/jobs/${job.id}`)).upload
  upload = uploadTask?.result?.upload
  if (!upload?.url) await sleep(500)
}
if (!upload?.url) throw new Error('no upload URL received')
const put = await fetch(upload.url, { method: 'PUT', body: await readFile(path) })
if (!put.ok) throw new Error(`upload: HTTP ${put.status}`)
await api('POST', `/tasks/${uploadTask.id}/upload-confirm`, {
  s3_key: upload.s3_key, filename: name, mime_type: 'application/octet-stream', file_size: size,
})

// 3. Poll until the job is finished, then download the result.
let done
for (;;) {
  done = await api('GET', `/jobs/${job.id}`)
  const status = String(done.status).toLowerCase()
  const failed = Object.values(tasksByName(done)).find((t) => String(t.status).toLowerCase() === 'error')
  if (status === 'error' || failed) throw new Error(`job ${job.id} failed: ${failed?.error ?? failed?.code ?? 'unknown error'}`)
  if (status === 'finished') break
  await sleep(1000)
}
const file = tasksByName(done).export.result.files[0]
const out = file.filename ?? `${basename(name, extname(name))}.${outputFormat}`
const dl = await fetch(file.url)
if (!dl.ok) throw new Error(`download: HTTP ${dl.status}`)
await writeFile(out, Buffer.from(await dl.arrayBuffer()))
console.log('saved', out)
