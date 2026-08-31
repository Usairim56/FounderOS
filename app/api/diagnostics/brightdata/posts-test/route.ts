import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { TEST3_DEFAULTS, normalizeFounderUrl, postsEndpoint, prepareBrightDataPosts, retainedDateRange, rowsFromProvider } from '@/lib/brightdata-test3'

const FIXTURE_PATH = path.join(process.cwd(), 'diagnostic-fixtures', 'test3b-ahroon-posts.json')

const DEFAULT_URL = 'https://www.linkedin.com/in/ahroon-santhosh'

type ProviderResult = {
  ok: boolean
  status: number | null
  statusText: string | null
  contentType: string | null
  rawBody: string
  parsedBody: unknown
  appearsJson: boolean
  records: Record<string, unknown>[]
  error: string | null
}

async function callBrightData(endpoint: string, payload: unknown, apiKey: string): Promise<ProviderResult> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    })
    const status = response.status
    const statusText = response.statusText
    const contentType = response.headers.get('content-type')
    const rawBody = await response.text()
    let parsedBody: unknown = null
    let appearsJson = false
    try {
      parsedBody = JSON.parse(rawBody)
      appearsJson = true
    } catch {
      const jsonLines = rawBody.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
        try {
          const value = JSON.parse(line)
          return value && typeof value === 'object' && !Array.isArray(value) ? [value] : []
        } catch {
          return []
        }
      })
      parsedBody = jsonLines.length > 0 ? jsonLines : null
    }
    return {
      ok: response.ok,
      status,
      statusText,
      contentType,
      rawBody,
      parsedBody,
      appearsJson,
      records: rowsFromProvider(parsedBody),
      error: response.ok ? null : `HTTP ${status}${statusText ? ` ${statusText}` : ''}`,
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      statusText: null,
      contentType: null,
      rawBody: '',
      parsedBody: null,
      appearsJson: false,
      records: [],
      error: error instanceof Error ? error.message : 'Bright Data request failed',
    }
  }
}

function profileSummary(record: Record<string, unknown> | undefined) {
  if (!record) return null
  const pick = (...keys: string[]) => { for (const key of keys) if (record[key] !== undefined && record[key] !== null && record[key] !== '') return { present: true, value: record[key] }; return { present: false, value: null } }
  return { name: pick('name'), position: pick('position', 'headline', 'title', 'occupation'), about: pick('about', 'bio', 'summary'), currentCompany: pick('current_company', 'current_company_name'), companyLinkedIn: pick('company_url', 'current_company_url', 'current_company_linkedin'), companyWebsite: pick('company_website', 'website'), profileUrl: pick('url', 'profile_url', 'input_url'), location: pick('location'), rawKeys: Object.keys(record).sort() }
}

export async function POST(request: Request) {
  let input: { founderLinkedInUrl?: string }
  try { input = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) }
  const normalizedUrl = normalizeFounderUrl(input.founderLinkedInUrl || '')
  if (!normalizedUrl || !normalizedUrl.startsWith('https://www.linkedin.com/in/')) return NextResponse.json({ error: 'founderLinkedInUrl must be a LinkedIn profile URL.' }, { status: 400 })
  const apiKey = process.env.BRIGHTDATA_API_KEY
  if (!apiKey) return NextResponse.json({ test: 'TEST 3: BRIGHT DATA CAPTURE + EVIDENCE PREPARATION', status: 'FAIL', error: 'BRIGHTDATA_API_KEY is not configured.', diagnosticBoundaries: { groqCalled: false, llmCalled: false, databaseMutated: false } }, { status: 502 })

  const requestPayload = {
    input: [{
      url: normalizedUrl,
      start_date: TEST3_DEFAULTS.startDate,
      end_date: TEST3_DEFAULTS.endDate,
      only_authored_posts: true,
    }],
    limit_per_input: null,
  }
  const posts = await callBrightData(postsEndpoint(), requestPayload, apiKey)
  const prepared = prepareBrightDataPosts(posts.records)
  const providerBody = posts.appearsJson ? posts.parsedBody : posts.rawBody
  let fixtureError: string | null = null
  try {
    await mkdir(path.dirname(FIXTURE_PATH), { recursive: true })
    await writeFile(FIXTURE_PATH, JSON.stringify({
      fixture: 'FounderOS TEST 3B Ahroon Santhosh Bright Data capture',
      capturedAt: new Date().toISOString(),
      request: {
        endpoint: postsEndpoint(),
        method: 'POST',
        query: { notify: 'false', include_errors: 'true', type: 'discover_new', discover_by: 'profile_url' },
        body: requestPayload,
        headers: { Authorization: 'Bearer [REDACTED]', 'Content-Type': 'application/json' },
      },
      response: { status: posts.status, statusText: posts.statusText, contentType: posts.contentType, rawBody: posts.rawBody, parsedBody: posts.parsedBody, appearsJson: posts.appearsJson, records: posts.records, error: posts.error },
      recordCount: posts.records.length,
    }, null, 2), 'utf8')
  } catch (error) {
    fixtureError = error instanceof Error ? error.message : 'Unable to persist diagnostic fixture'
  }
  const dateRange = retainedDateRange(prepared.retained)
  const requestConfig = {
    endpoint: postsEndpoint(),
    method: 'POST',
    query: { notify: 'false', include_errors: 'true', type: 'discover_new', discover_by: 'profile_url' },
    body: requestPayload,
    headers: { Authorization: 'Bearer [REDACTED]', 'Content-Type': 'application/json' },
  }

  return NextResponse.json({
    test: 'TEST 3B: BRIGHT DATA CAPTURE + DETERMINISTIC PREPARATION',
    input: { founderLinkedInUrl: normalizedUrl },
    requestConfig,
    httpStatus: posts.status,
    statusText: posts.statusText,
    responseContentType: posts.contentType,
    rawResponseBody: posts.rawBody,
    rawJson: providerBody,
    appearsJson: posts.appearsJson,
    rawRecordCount: posts.records.length,
    parsedRecordCount: posts.records.length,
    providerError: posts.error,
    datasetId: TEST3_DEFAULTS.postsDataset,
    requestReachedBrightData: posts.status !== null,
    fixture: { path: 'diagnostic-fixtures/test3b-ahroon-posts.json', created: fixtureError === null, error: fixtureError },
    deterministicPreparation: {
      recognizedPosts: prepared.recognizedPosts,
      malformedRecords: prepared.malformedRecords,
      duplicatePostIds: prepared.duplicatePostIds,
      duplicatePostUrls: prepared.duplicatePostUrls,
      finalUniqueUsableRecords: prepared.retained.length,
      dateRange,
      retainedPosts: prepared.retained,
      removed: prepared.removed,
    },
    boundaries: { brightDataCalls: 1, groqCalls: 0, llmCalls: 0, databaseMutations: 0, semanticFiltering: false, repostFiltering: false, productionResearchPipeline: false },
  }, { status: posts.status && posts.status >= 200 && posts.status < 300 ? 200 : 502 })
}

export const dynamic = 'force-dynamic'
export const maxDuration = 150

export async function GET() { return POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ founderLinkedInUrl: DEFAULT_URL }), headers: { 'content-type': 'application/json' } })) }
