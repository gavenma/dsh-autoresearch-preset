// Linear GraphQL transport helper (run under `node` by the linear plugin).
// Contract:
//   stdin:  JSON { query: string, variables?: object }
//   env:    LINEAR_API_KEY (required; sent as Authorization header, never echoed),
//           LINEAR_ENDPOINT (default https://api.linear.app/graphql; tests override it)
//   stdout: JSON { statusCode, bodyText, attempts } on success, or { error } on failure
//   retry:  bounded retries for transient network failures and 408/425/429/5xx
//   exit:   0 on transport success (even for non-2xx HTTP), 1 on infra failure,
//           2 on malformed stdin JSON.
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)

let input
try {
  input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
} catch {
  console.error('linear-client: stdin is not valid JSON')
  process.exit(2)
}
if (input === null || typeof input !== 'object' || typeof input.query !== 'string' || input.query.trim() === '') {
  console.error('linear-client: stdin JSON requires a non-empty string "query"')
  process.exit(2)
}

const token = process.env.LINEAR_API_KEY
if (!token || !token.trim()) {
  process.stdout.write(JSON.stringify({ error: 'LINEAR_API_KEY is not set in the environment' }))
  process.exit(0)
}

const endpoint = process.env.LINEAR_ENDPOINT || 'https://api.linear.app/graphql'
const variables = input.variables !== undefined ? input.variables : {}
const maxAttempts = 3
const attemptTimeoutMs = 8_000
const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504])
const payload = JSON.stringify({ query: input.query, variables })

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  const code = error?.cause && typeof error.cause === 'object' && typeof error.cause.code === 'string'
    ? error.cause.code
    : ''
  return code ? `${message} (${code})` : message
}

function retryDelay(response, attempt) {
  const value = response?.headers?.get('retry-after')
  if (value) {
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 4_000)
    const date = Date.parse(value)
    if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 4_000)
  }
  return 250 * attempt
}

let lastError = 'unknown transport failure'
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: token,
      },
      body: payload,
      signal: AbortSignal.timeout(attemptTimeoutMs),
    })
    const bodyText = await response.text()
    if (retryableStatuses.has(response.status) && attempt < maxAttempts) {
      lastError = `HTTP ${response.status}`
      await sleep(retryDelay(response, attempt))
      continue
    }
    process.stdout.write(JSON.stringify({ statusCode: response.status, bodyText, attempts: attempt }))
    process.exit(0)
  } catch (error) {
    lastError = safeError(error)
    if (attempt < maxAttempts) {
      await sleep(250 * attempt)
      continue
    }
  }
}

process.stdout.write(JSON.stringify({ error: `Linear transport failed after ${maxAttempts} attempts: ${lastError}` }))
process.exit(1)
