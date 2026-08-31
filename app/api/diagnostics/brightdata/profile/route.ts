import { NextResponse } from 'next/server'

const DEFAULT_DATASET_ID = 'gd_l1viktl72bvl7bjuj0'
const PROFILE_URL = 'https://www.linkedin.com/in/jandamm/'

type ProviderResult = {
  status: number | null
  ok: boolean
  body: unknown
  error?: string
}

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

function rowsFrom(body: any): any[] {
  if (Array.isArray(body)) return body
  if (Array.isArray(body?.data)) return body.data
  if (Array.isArray(body?.results)) return body.results
  return []
}

function firstValue(row: any, keys: string[]) {
  for (const key of keys) {
    const value = key.split('.').reduce((current, part) => current?.[part], row)
    if (value !== undefined && value !== null && value !== '') return value
  }
  return null
}

async function callBrightData(normalizedUrl: string, datasetId: string, apiKey: string): Promise<ProviderResult> {
  const endpoint = `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${encodeURIComponent(datasetId)}&format=json`
  const requestPayload = [{ url: normalizedUrl }]
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(30000),
    })
    const text = await response.text()
    let body: unknown
    try { body = JSON.parse(text) } catch { body = text }
    return { status: response.status, ok: response.ok, body, error: response.ok ? undefined : `HTTP ${response.status}` }
  } catch (error) {
    return { status: null, ok: false, body: null, error: error instanceof Error ? error.message : 'Bright Data request failed' }
  }
}

export async function POST(request: Request) {
  let input: { founderLinkedInUrl?: string }
  try { input = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }) }
  const originalUrl = input.founderLinkedInUrl?.trim()
  if (!originalUrl) return NextResponse.json({ error: 'founderLinkedInUrl is required.' }, { status: 400 })
  const normalizedUrl = normalizeLinkedInUrl(originalUrl)
  const datasetId = process.env.BRIGHTDATA_LINKEDIN_DATASET_ID || DEFAULT_DATASET_ID
  const endpoint = `https://api.brightdata.com/datasets/v3/scrape?dataset_id=${encodeURIComponent(datasetId)}&format=json`
  const requestPayload = [{ url: normalizedUrl }]
  const apiKey = process.env.BRIGHTDATA_API_KEY
  const authStatus = apiKey ? 'configured (redacted)' : 'missing'
  const provider = apiKey ? await callBrightData(normalizedUrl, datasetId, apiKey) : { status: null, ok: false, body: null, error: 'BRIGHTDATA_API_KEY is not configured.' }
  const rows = rowsFrom(provider.body)
  const row = rows[0]
  const extracted = row ? {
    fullName: { present: firstValue(row, ['name', 'full_name', 'fullName']), value: firstValue(row, ['name', 'full_name', 'fullName']) },
    headline: { present: firstValue(row, ['headline', 'occupation', 'job_title']) !== null, value: firstValue(row, ['headline', 'occupation', 'job_title']) },
    profileUrl: { present: firstValue(row, ['url', 'linkedin_url', 'profile_url']) !== null, value: firstValue(row, ['url', 'linkedin_url', 'profile_url']) },
    currentPosition: { present: firstValue(row, ['current_position', 'currentPosition', 'experiences.0.title']) !== null, value: firstValue(row, ['current_position', 'currentPosition', 'experiences.0.title']) },
    currentCompany: { present: firstValue(row, ['current_company', 'currentCompany', 'company_name', 'experiences.0.company']) !== null, value: firstValue(row, ['current_company', 'currentCompany', 'company_name', 'experiences.0.company']) },
    companyLinkedIn: { present: firstValue(row, ['company_linkedin_url', 'company_url', 'company.linkedin_url']) !== null, value: firstValue(row, ['company_linkedin_url', 'company_url', 'company.linkedin_url']) },
    companyWebsite: { present: firstValue(row, ['company_website', 'company.website']) !== null, value: firstValue(row, ['company_website', 'company.website']) },
    location: { present: firstValue(row, ['location', 'city', 'geo_location']) !== null, value: firstValue(row, ['location', 'city', 'geo_location']) },
  } : null
  const usable = provider.ok && rows.length > 0 && Boolean(extracted?.fullName.value || extracted?.profileUrl.value)
  return NextResponse.json({
    test: 'TEST 1: BRIGHT DATA PROFILE',
    status: usable ? 'PASS' : 'FAIL',
    input: { originalUrl, normalizedUrl },
    brightDataRequest: { endpoint, datasetId, method: 'POST', requestPayload, authentication: authStatus, httpStatus: provider.status, success: provider.ok },
    rawProviderResponse: provider.body,
    rawRecordsReturned: rows.length,
    extractedProfile: extracted,
    result: usable ? 'PASS — Bright Data successfully returned a usable founder profile.' : 'FAIL — Bright Data did not return a usable founder profile.',
    providerStatus: provider.ok ? 'SUCCESS' : 'FAILURE',
    parserStatus: row ? 'PARSED' : 'NO_USABLE_PROFILE_ROW',
    failureReason: usable ? null : provider.error || (provider.ok ? 'Bright Data response contained no usable profile record.' : 'Provider request failed.'),
  }, { status: usable ? 200 : 502 })
}

export async function GET() {
  return POST(new Request('http://localhost/api/diagnostics/brightdata/profile', { method: 'POST', body: JSON.stringify({ founderLinkedInUrl: PROFILE_URL }), headers: { 'content-type': 'application/json' } }))
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
