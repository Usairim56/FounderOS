import { NextResponse } from 'next/server'

const DEFAULT_DATASET_ID = 'gd_l1viktl72bvl7bjuj0'
const DEFAULT_PROFILE_URL = 'https://www.linkedin.com/in/jandamm/'

function normalizeLinkedInUrl(value: string) {
  try {
    const url = new URL(value.trim())
    url.protocol = 'https:'
    url.hostname = url.hostname.toLowerCase()
    url.hash = ''
    url.search = ''
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
    return url.toString()
  } catch {
    return value.trim()
  }
}

function rowsFrom(body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    const value = body as Record<string, unknown>
    if (Array.isArray(value.data)) return value.data
    if (Array.isArray(value.results)) return value.results
  }
  return []
}

async function run(profileUrl: string) {
  const normalizedUrl = normalizeLinkedInUrl(profileUrl)
  const datasetId = process.env.BRIGHTDATA_LINKEDIN_POSTS_DATASET_ID || process.env.BRIGHTDATA_LINKEDIN_DATASET_ID || DEFAULT_DATASET_ID
  const endpoint = `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${encodeURIComponent(datasetId)}&format=json`
  const requestPayload = [{ url: normalizedUrl }]
  const apiKey = process.env.BRIGHTDATA_API_KEY

  if (!apiKey) {
    return NextResponse.json({
      test: 'TEST 2: BRIGHT DATA LINKEDIN POSTS', status: 'FAIL', input: { requestedProfileUrl: profileUrl, normalizedProfileUrl: normalizedUrl },
      brightDataRequest: { endpoint, datasetId, method: 'POST', requestPayload, authentication: 'missing (redacted)' },
      rawProviderResponse: null, rawRecordsReturned: 0, providerStatus: 'FAILURE', failureReason: 'BRIGHTDATA_API_KEY is not configured.',
    }, { status: 502 })
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(60000),
    })
    const text = await response.text()
    let rawProviderResponse: unknown
    try { rawProviderResponse = JSON.parse(text) } catch { rawProviderResponse = text }
    const rawRecords = rowsFrom(rawProviderResponse)
    return NextResponse.json({
      test: 'TEST 2: BRIGHT DATA LINKEDIN POSTS', status: response.ok ? 'PASS' : 'FAIL',
      input: { requestedProfileUrl: profileUrl, normalizedProfileUrl: normalizedUrl },
      brightDataRequest: { endpoint, datasetId, method: 'POST', requestPayload, authentication: 'configured (redacted)', httpStatus: response.status, success: response.ok },
      rawProviderResponse, rawRecordsReturned: rawRecords.length, rawRecords,
      providerStatus: response.ok ? 'SUCCESS' : 'FAILURE', failureReason: response.ok ? null : `HTTP ${response.status}`,
    }, { status: response.ok ? 200 : 502 })
  } catch (error) {
    return NextResponse.json({
      test: 'TEST 2: BRIGHT DATA LINKEDIN POSTS', status: 'FAIL', input: { requestedProfileUrl: profileUrl, normalizedProfileUrl: normalizedUrl },
      brightDataRequest: { endpoint, datasetId, method: 'POST', requestPayload, authentication: 'configured (redacted)', httpStatus: null, success: false },
      rawProviderResponse: null, rawRecordsReturned: 0, providerStatus: 'FAILURE', failureReason: error instanceof Error ? error.message : 'Bright Data request failed',
    }, { status: 502 })
  }
}

export async function POST(request: Request) {
  let input: { profileUrl?: string }
  try { input = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) }
  const profileUrl = input.profileUrl?.trim()
  if (!profileUrl) return NextResponse.json({ error: 'profileUrl is required.' }, { status: 400 })
  return run(profileUrl)
}

export async function GET() { return run(DEFAULT_PROFILE_URL) }

export const dynamic = 'force-dynamic'
export const maxDuration = 90
