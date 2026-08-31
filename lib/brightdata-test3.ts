export type BrightDataRecord = Record<string, unknown>

export type PreparedPost = {
  postId: string | null
  postUrl: string | null
  authorUserId: string | null
  authorName: string | null
  datePosted: string | null
  postType: string | null
  postText: string | null
  taggedCompanies: unknown
  engagement: unknown
  providerFields: BrightDataRecord
}

export type PreparationResult = {
  recognizedPosts: number
  malformedRecords: number
  duplicatePostIds: number
  duplicatePostUrls: number
  retained: PreparedPost[]
  removed: Array<{ index: number; reason: string; postId: string | null; postUrl: string | null }>
}

export const TEST3_DEFAULTS = {
  profileDataset: 'gd_l1viktl72bvl7bjuj0',
  postsDataset: 'gd_lyy3tktm25m4avu764',
  startDate: '2026-02-27T00:00:00.000Z',
  endDate: '2026-08-27T23:59:59.999Z',
}

export function normalizeProviderUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    url.protocol = 'https:'
    url.hostname = url.hostname.toLowerCase()
    url.hash = ''
    url.search = ''
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString()
  } catch { return null }
}

function first(record: BrightDataRecord, keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null && record[key] !== '') return record[key]
  return null
}
function asText(value: unknown): string | null { return value == null ? null : String(value).trim() || null }
function normalizeDate(value: unknown): string | null {
  const text = asText(value)
  if (!text) return null
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text
}

export function rowsFromProvider(body: unknown): BrightDataRecord[] {
  if (Array.isArray(body)) return body.filter((row): row is BrightDataRecord => Boolean(row && typeof row === 'object' && !Array.isArray(row)))
  if (!body || typeof body !== 'object') return []
  const object = body as BrightDataRecord
  for (const key of ['data', 'results', 'records', 'items']) {
    if (Array.isArray(object[key])) return object[key].filter((row): row is BrightDataRecord => Boolean(row && typeof row === 'object' && !Array.isArray(row)))
  }
  return []
}

export function prepareBrightDataPosts(rawRecords: BrightDataRecord[]): PreparationResult {
  const seenIds = new Set<string>()
  const seenUrls = new Set<string>()
  const result: PreparationResult = { recognizedPosts: 0, malformedRecords: 0, duplicatePostIds: 0, duplicatePostUrls: 0, retained: [], removed: [] }

  rawRecords.forEach((raw, index) => {
    const postId = asText(first(raw, ['post_id', 'postId', 'activity_id', 'id', 'urn']))
    const postUrl = normalizeProviderUrl(first(raw, ['post_url', 'postUrl', 'share_url', 'activity_url', 'url']))
    const postText = asText(first(raw, ['post_text', 'text', 'content', 'description', 'commentary']))
    const datePosted = normalizeDate(first(raw, ['date_posted', 'posted_at', 'post_date', 'date', 'created_at', 'timestamp']))
    const recognized = Boolean(postId || postUrl || postText || datePosted)
    if (recognized) result.recognizedPosts += 1
    if (!recognized) { result.malformedRecords += 1; result.removed.push({ index, reason: 'malformed_or_empty', postId, postUrl }); return }
    if (!postId && !postUrl) { result.malformedRecords += 1; result.removed.push({ index, reason: 'missing_post_id_and_url', postId, postUrl }); return }
    const idKey = postId?.toLowerCase() ?? null
    if (idKey && seenIds.has(idKey)) { result.duplicatePostIds += 1; result.removed.push({ index, reason: 'duplicate_post_id', postId, postUrl }); return }
    if (postUrl && seenUrls.has(postUrl)) { result.duplicatePostUrls += 1; result.removed.push({ index, reason: 'duplicate_post_url', postId, postUrl }); return }
    if (idKey) seenIds.add(idKey)
    if (postUrl) seenUrls.add(postUrl)
    result.retained.push({
      postId, postUrl,
      authorUserId: asText(first(raw, ['author_id', 'author_user_id', 'user_id', 'profile_id'])),
      authorName: asText(first(raw, ['author_name', 'author', 'user_name', 'name'])),
      datePosted,
      postType: asText(first(raw, ['post_type', 'type', 'activity_type'])),
      postText: postText?.replace(/\r\n/g, '\n') || null,
      taggedCompanies: first(raw, ['tagged_companies', 'mentioned_companies', 'company_mentions']),
      engagement: first(raw, ['engagement', 'engagements', 'likes', 'reactions', 'comments', 'shares']),
      providerFields: raw,
    })
  })

  result.retained.sort((a, b) => {
    const left = Date.parse(a.datePosted || ''), right = Date.parse(b.datePosted || '')
    if (Number.isFinite(left) && Number.isFinite(right)) return right - left
    return Number.isFinite(right) ? 1 : Number.isFinite(left) ? -1 : 0
  })
  return result
}

export function normalizeFounderUrl(value: string) { return normalizeProviderUrl(value) || value.trim() }
export function postsEndpoint(datasetId = TEST3_DEFAULTS.postsDataset) { return `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${encodeURIComponent(datasetId)}&notify=false&include_errors=true&type=discover_new&discover_by=profile_url` }
export function profileEndpoint(datasetId = TEST3_DEFAULTS.profileDataset) { return `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${encodeURIComponent(datasetId)}&format=json` }
export function postsPayload(url: string) { return [{ url, start_date: TEST3_DEFAULTS.startDate, end_date: TEST3_DEFAULTS.endDate }] }
export function profilePayload(url: string) { return [{ url }] }
export function providerKeys(records: BrightDataRecord[]) { return [...new Set(records.flatMap(Object.keys))].sort() }
export function retainedDateRange(posts: PreparedPost[]) { return { oldest: posts.at(-1)?.datePosted ?? null, newest: posts[0]?.datePosted ?? null } }
export function duplicateCount(result: PreparationResult) { return result.duplicatePostIds + result.duplicatePostUrls }
