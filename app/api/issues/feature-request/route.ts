import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'

interface FeatureRequestBody {
  title: string
  description: string
  use_case: string
}

export async function POST(request: NextRequest) {
  let body: FeatureRequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { title, description, use_case } = body

  if (!title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!description?.trim()) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 })
  }
  if (!use_case?.trim()) {
    return NextResponse.json({ error: 'use_case is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Duplicate check — search existing open/active features with similar title
  const { data: matches } = await supabase
    .from('issues')
    .select('id, task_key, title, status, description')
    .eq('type', 'feature')
    .not('status', 'in', '("completed","closed")')
    .ilike('title', `%${title.trim().split(' ').slice(0, 4).join('%')}%`)
    .limit(5)

  if (matches && matches.length > 0) {
    return NextResponse.json({ matches, created: null }, { status: 200 })
  }

  // No duplicates — create the feature issue
  const fullDescription = `${description.trim()}\n\n**Use case / Why this matters:**\n${use_case.trim()}`

  const { data: created, error } = await supabase
    .from('issues')
    .insert({
      title: title.trim(),
      description: fullDescription,
      project: 'Todero',
      type: 'feature',
      priority: 'medium',
      status: 'backlog',
      assignee: 'po',
      acceptance_criteria: `Feature request submitted via Support tab.\n\nUse case: ${use_case.trim()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ matches: [], created }, { status: 201 })
}
