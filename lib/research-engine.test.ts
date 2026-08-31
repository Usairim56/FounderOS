import assert from 'node:assert/strict'
import { mechanicalFilter, postingPattern, researchConfig, type Evidence } from './research-engine'

const recent = new Date().toISOString()
const items: Evidence[] = [
  { url: 'https://www.linkedin.com/posts/luke-1/?utm_source=x', title: 'Recent', excerpt: 'A useful founder update', sourceType: 'FOUNDER_POST', provider: 'Bright Data', publishedAt: recent, retrievedAt: recent, author: 'Luke' },
  { url: 'https://www.linkedin.com/posts/luke-1/', title: 'Duplicate', excerpt: 'A useful founder update', sourceType: 'FOUNDER_POST', provider: 'Bright Data', publishedAt: recent, retrievedAt: recent, author: 'Luke' },
  { url: 'https://www.linkedin.com/posts/luke-old/', title: 'Old', excerpt: 'Old update', sourceType: 'FOUNDER_POST', provider: 'Bright Data', publishedAt: '2020-01-01T00:00:00.000Z', retrievedAt: recent, author: 'Luke' },
]

const state = { sourcesInspected: [], postsInspected: [] } as any
const filtered = mechanicalFilter(items, state, researchConfig())
assert.equal(filtered.length, 1, 'cutoff and URL/content dedupe should leave one item')
assert.equal(postingPattern(filtered), 'NO_POSTS', 'one post is not a high-frequency pattern')
assert.ok(researchConfig().maxEvidenceItems > 0)
console.log('research-engine checks passed')
