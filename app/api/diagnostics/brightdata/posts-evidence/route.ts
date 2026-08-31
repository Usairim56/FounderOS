import { NextResponse } from 'next/server'

const DEFAULT_DATASET_ID = 'gd_l1viktl72bvl7bjuj0'
const DEFAULT_PROFILE_URL = 'https://www.linkedin.com/in/ahroon-santhosh'

type AnyRecord = Record<string, unknown>

function normalizeUrl(value: unknown): string | null {
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

function rowsFrom(body: unknown): AnyRecord[] {
  if (Array.isArray(body)) return body.filter((row): row is AnyRecord => Boolean(row && typeof row === 'object'))
  if (body && typeof body === 'object') {
    const record = body as AnyRecord
    for (const key of ['data', 'results', 'records', 'items']) {
      if (Array.isArray(record[key])) return record[key].filter((row): row is AnyRecord => Boolean(row && typeof row === 'object'))
    }
  }
  return []
}

function value(record: AnyRecord, keys: string[]) {
  for (const key of keys) {
    const found = record[key]
    if (found !== undefined && found !== null && found !== '') return found
  }
  return null
}

function textValue(record: AnyRecord, keys: string[]) {
  const found = value(record, keys)
  return typeof found === 'string' ? found : found == null ? null : String(found)
}

function prepare(rawRecords: AnyRecord[]) {
  const seenIds = new Set<string>()
  const seenUrls = new Set<string>()
  const removed: Array<{ index: number; reason: string; recordId: string | null; postUrl: string | null }> = []
  const retained: AnyRecord[] = []
  let recognized = 0
  let malformed = 0
  let duplicatePostIds = 0
  let duplicatePostUrls = 0

  rawRecords.forEach((raw, index) => {
    const id = textValue(raw, ['post_id', 'postId', 'id', 'urn', 'activity_id'])
    const postUrl = normalizeUrl(value(raw, ['post_url', 'postUrl', 'url', 'share_url', 'activity_url', 'linkedin_url']))
    const text = textValue(raw, ['post_text', 'text', 'content', 'description', 'commentary', 'title'])
    const date = textValue(raw, ['date_posted', 'posted_at', 'post_date', 'date', 'timestamp', 'created_at'])
    const looksLikePost = Boolean(postUrl || id || text || date)
    if (looksLikePost) recognized += 1
    if (!looksLikePost) {
      malformed += 1
      removed.push({ index, reason: 'malformed_or_not_a_post', recordId: id, postUrl })
      return
    }
    if (!postUrl && !id) {
      malformed += 1
      removed.push({ index, reason: 'missing_post_url_and_id', recordId: id, postUrl })
      return
    }
    const idKey = id?.trim().toLowerCase() || null
    if (idKey && seenIds.has(idKey)) {
      duplicatePostIds += 1
      removed.push({ index, reason: 'duplicate_post_id', recordId: id, postUrl })
      return
    }
    if (postUrl && seenUrls.has(postUrl)) {
      duplicatePostUrls += 1
      removed.push({ index, reason: 'duplicate_post_url', recordId: id, postUrl })
      return
    }
    if (idKey) seenIds.add(idKey)
    if (postUrl) seenUrls.add(postUrl)
    retained.push({
      postId: id,
      postUrl,
      authorUserId: value(raw, ['author_id', 'author_user_id', 'user_id', 'profile_id']),
      authorName: value(raw, ['author_name', 'author', 'user_name', 'name']),
      datePosted: date,
      postType: value(raw, ['post_type', 'type', 'activity_type']),
      postText: text,
      taggedCompanies: value(raw, ['tagged_companies', 'mentioned_companies', 'company_mentions']),
      engagement: value(raw, ['engagement', 'engagements', 'likes', 'reactions', 'comments', 'shares']),
      rawRecordId: id,
      raw,
    })
  })

  retained.sort((a, b) => {
    const left = Date.parse(String(a.datePosted || ''))
    const right = Date.parse(String(b.datePosted || ''))
    if (Number.isFinite(left) && Number.isFinite(right)) return right - left
    return Number.isFinite(right) ? 1 : Number.isFinite(left) ? -1 : 0
  })
  return { recognized, malformed, duplicatePostIds, duplicatePostUrls, retained, removed }
}

async function run(profileUrl: string) {
  const normalizedProfileUrl = normalizeUrl(profileUrl) || profileUrl.trim()
  const datasetId = process.env.BRIGHTDATA_LINKEDIN_POSTS_DATASET_ID || process.env.BRIGHTDATA_LINKEDIN_DATASET_ID || DEFAULT_DATASET_ID
  const endpoint = `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${encodeURIComponent(datasetId)}&format=json`
  const requestPayload = [{ url: normalizedProfileUrl }]
  const apiKey = process.env.BRIGHTDATA_API_KEY
  if (!apiKey) return NextResponse.json({ test: 'TEST 3: BRIGHT DATA → EVIDENCE PREPARATION', status: 'FAIL', input: { profileUrl, normalizedProfileUrl }, brightDataRequest: { endpoint, datasetId, method: 'POST', requestPayload, authentication: 'missing (redacted)' }, providerStatus: 'FAILURE', rawProviderResponse: null, rawRecordsReturned: 0, failureReason: 'BRIGHTDATA_API_KEY is not configured.' }, { status: 502 })
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(requestPayload), signal: AbortSignal.timeout(60000) })
    const responseText = await response.text()
    let rawProviderResponse: unknown
    try { rawProviderResponse = JSON.parse(responseText) } catch { rawProviderResponse = responseText }
    const rawRecords = rowsFrom(rawProviderResponse)
    const prepared = prepare(rawRecords)
    return NextResponse.json({ test: 'TEST 3: BRIGHT DATA → EVIDENCE PREPARATION', status: response.ok ? 'PASS' : 'FAIL', input: { founder: 'Ahroon Santhosh', profileUrl, normalizedProfileUrl }, brightDataRequest: { endpoint, datasetId, method: 'POST', requestPayload, authentication: 'configured (redacted)', httpStatus: response.status, success: response.ok }, providerStatus: response.ok ? 'SUCCESS' : 'FAILURE', rawProviderResponse, rawRecordsReturned: rawRecords.length, recognizedLinkedInPosts: prepared.recognized, malformedOrEmptyRecords: prepared.malformed, duplicatePostIds: prepared.duplicatePostIds, duplicatePostUrls: prepared.duplicatePostUrls, validUniquePosts: prepared.retained.length, duplicatesRemoved: prepared.duplicatePostIds + prepared.duplicatePostUrls, rawRecords, retainedPosts: prepared.retained, removedRecords: prepared.removed, evidencePreparation: 'PASS' }, { status: response.ok ? 200 : 502 })
  } catch (error) {
    return NextResponse.json({ test: 'TEST 3: BRIGHT DATA → EVIDENCE PREPARATION', status: 'FAIL', input: { founder: 'Ahroon Santhosh', profileUrl, normalizedProfileUrl }, brightDataRequest: { endpoint, datasetId, method: 'POST', requestPayload, authentication: 'configured (redacted)', httpStatus: null, success: false }, providerStatus: 'FAILURE', rawProviderResponse: null, rawRecordsReturned: 0, evidencePreparation: 'FAIL', failureReason: error instanceof Error ? error.message : 'Bright Data request failed' }, { status: 502 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { profileUrl?: string }
    if (!body.profileUrl?.trim()) return NextResponse.json({ error: 'profileUrl is required.' }, { status: 400 })
    return run(body.profileUrl)
  } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) }
}

export async function GET() { return run(DEFAULT_PROFILE_URL) }
export const dynamic = 'force-dynamic'
export const maxDuration = 90
