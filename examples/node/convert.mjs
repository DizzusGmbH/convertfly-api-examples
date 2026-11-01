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

async function api(method, url, body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${url}: HTTP ${res.status} ${await res.text()}`)
  return { status: res.status, json: await res.json() }
}

const byName = (job) => Object.fromEntries(job.tasks.map((t) => [t.name, t]))

const name = basename(path)
const { size } = await stat(path)

// 1. Create the job: upload -> convert -> export. The upload URL comes back at once.
let { json: job } = await api('POST', '/jobs', {
  tasks: {
    upload: { operation: 'import/upload', filename: name, file_size: size },
    convert: { operation: 'convert', input: 'upload', output_format: outputFormat },
    export: { operation: 'export/url', input: 'convert' },
  },
})
const uploadTask = byName(job).upload
const upload = uploadTask.result?.upload
if (!upload) throw new Error(`upload refused: ${uploadTask.error ?? uploadTask.code}`)

// 2. Send the file, then confirm the upload: the conversion starts right away.
const put = await fetch(upload.url, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/octet-stream' },
  body: await readFile(path),
})
if (!put.ok) throw new Error(`upload: HTTP ${put.status}`)
await api('POST', `/tasks/${uploadTask.id}/upload-confirm`, {
  s3_key: upload.s3_key, filename: name, mime_type: 'application/octet-stream', file_size: size,
})

// 3. Wait for the job: /wait answers 200 once it is finished, 202 after about 30 s.
for (;;) {
  const { status, json } = await api('GET', `/jobs/${job.id}/wait`)
  if (status === 200) { job = json; break }
}
if (job.status !== 'finished') {
  // The task that failed first; the ones it blocked say DEPENDENCY_FAILED.
  const failed = job.tasks
    .filter((t) => t.status === 'error')
    .sort((a, b) => (a.code === 'DEPENDENCY_FAILED') - (b.code === 'DEPENDENCY_FAILED'))[0]
  throw new Error(`job ${job.id} failed: ${failed?.error ?? failed?.code ?? 'unknown error'}`)
}

// 4. Download the result.
const file = byName(job).export.result.files[0]
const out = basename(file.filename ?? '') || `${basename(name, extname(name))}.${outputFormat}`
const dl = await fetch(file.url)
if (!dl.ok) throw new Error(`download: HTTP ${dl.status}`)
await writeFile(out, Buffer.from(await dl.arrayBuffer()))
console.log('saved', out)
