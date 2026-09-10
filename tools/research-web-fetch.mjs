import { fetchDirect, normalizeConfig } from './fetch-source.mjs'

// OPTIONAL fallback provider: registers the anonymous HTTP(S)+PDF fetcher on the
// host `web` service.
//
// This row is deliberately NOT mounted by `agent.cordis.yml`. 0.1.5's base
// bundle mounts `@deepseek-ai/dsh-web-fetch-http` for every profile, and the
// `web` capability resolves to EXACTLY ONE usable provider — registering a
// second one raises `WEB_PROVIDER_AMBIGUOUS` for `ctx.web.fetch()` and for
// `autoresearch_dependency_preflight`. Mount this row only on a deployment
// whose host mounts no fetch provider at all.
//
// The transport and PDF extraction live in `./fetch-source.mjs`, shared with the
// standard-first coordinator path, so this file holds only the provider shape.

export const name = 'research-web-fetch'
export const inject = ['web']

export class ResearchFetchProvider {
  constructor(config = {}) {
    this.id = 'research-http-pdf'
    this.config = normalizeConfig(config)
  }

  available() {
    return typeof fetch === 'function'
  }

  async fetch(request, upstreamSignal) {
    const result = await fetchDirect(request.url, this.config, { signal: upstreamSignal })
    return {
      url: result.url,
      statusCode: result.statusCode,
      body: { kind: result.kind === 'html' ? 'html' : 'text', content: result.content },
      truncated: result.truncated,
    }
  }
}

export function apply(ctx, config = {}) {
  const resolved = normalizeConfig(config)
  const web = ctx.get('web')
  if (!web) throw new Error('web service is required')
  // A preset can mount beside an already-mounted provider; the registry is
  // process-scoped, so reuse the installed one instead of failing the mount.
  if (web.fetchProviders instanceof Map && web.fetchProviders.has('research-http-pdf')) return
  try {
    web.registerFetchProvider(new ResearchFetchProvider(resolved))
  } catch (error) {
    if (error?.code === 'WEB_DUPLICATE_PROVIDER' || String(error?.message ?? '').includes('already registered')) return
    throw error
  }
}
