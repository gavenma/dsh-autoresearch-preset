import assert from 'node:assert/strict'
import { apply, ResearchFetchProvider } from '../tools/research-web-fetch.mjs'

let registered
apply({
  get(name) {
    if (name !== 'web') return undefined
    return {
      fetchProviders: new Map(),
      registerFetchProvider(provider) {
        registered = provider
        return () => {}
      },
    }
  },
}, {})
assert.ok(registered instanceof ResearchFetchProvider)
assert.equal(registered.id, 'research-http-pdf')

let registerCalls = 0
apply({
  get(name) {
    if (name !== 'web') return undefined
    return {
      fetchProviders: {},
      registerFetchProvider() {
        registerCalls += 1
        const error = new Error('a web provider with id "research-http-pdf" is already registered')
        error.code = 'WEB_DUPLICATE_PROVIDER'
        throw error
      },
    }
  },
}, {})
assert.equal(registerCalls, 1)

apply({
  get(name) {
    if (name !== 'web') return undefined
    return { fetchProviders: new Map([['research-http-pdf', registered]]) }
  },
}, {})

console.log('web fetch provider mount tests passed')
