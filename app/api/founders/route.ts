import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { founders, founderEvents } from '@/lib/db/schema'
import { desc, eq } from 'drizzle-orm'

export async function GET() {
  const rows = await db.select().from(founders).orderBy(desc(founders.updatedAt))
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const body = await request.json()
  const founderLinkedinUrl = typeof body.founderLinkedinUrl === 'string' ? body.founderLinkedinUrl.trim() : ''
  if (!founderLinkedinUrl) return NextResponse.json({ error: 'Founder LinkedIn URL is required.' }, { status: 400 })
  try { new URL(founderLinkedinUrl) } catch { return NextResponse.json({ error: 'Enter a valid founder LinkedIn URL.' }, { status: 400 }) }
  const [founder] = await db.insert(founders).values({ name: body.name?.trim() || 'Undiscovered founder', companyName: body.companyName?.trim() || 'Undiscovered company', founderLinkedinUrl, companyLinkedinUrl: body.companyLinkedinUrl?.trim() || null, companyWebsite: body.companyWebsite?.trim() || null, privateNotes: body.privateNotes?.trim() || null }).returning()
  await db.insert(founderEvents).values({ founderId: founder.id, status: 'DISCOVERED', note: 'Founder added to workspace.' })
  return NextResponse.json(founder)
}

export async function PATCH(request: Request) {
  const body = await request.json()
  const [founder] = await db.update(founders).set({ status: body.status, askText: body.askText, askApproved: body.askApproved, researchDepth: body.researchDepth, updatedAt: new Date() }).where(eq(founders.id, body.id)).returning()
  if (body.status) await db.insert(founderEvents).values({ founderId: body.id, status: body.status, note: body.note || null })
  return NextResponse.json(founder)
}
