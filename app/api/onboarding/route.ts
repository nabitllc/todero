import { NextResponse } from 'next/server'
import { db, type DbAdapter } from '@/lib/db'

/**
 * Who owns a workspace created by the onboarding wizard.
 * Used to be the author's own address, hardcoded — which made every install of
 * Todero create businesses owned by someone the operator has never met.
 */
const WORKSPACE_OWNER = process.env.TODERO_OWNER_EMAIL ?? 'owner@localhost'

let _supabase: DbAdapter | null = null
function getSupabase(): DbAdapter {
  if (!_supabase) {
    _supabase = db()
  }
  return _supabase
}

export async function POST(req: Request) {
  const { name, type, vision, agentName, model, apiKey, taskTitle, taskDescription } = await req.json()
  if (!name || !type) return NextResponse.json({ error: 'name and type required' }, { status: 400 })

  const supabase = getSupabase()

  // Create business
  const { data: business, error: bErr } = await supabase
    .from('businesses').insert({ name, type, owner: WORKSPACE_OWNER, status: 'active' }).select().single()
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 })

  // Create first sprint
  const today = new Date().toISOString().split('T')[0]
  const endDate = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
  await supabase.from('sprints').insert({
    name: 'Sprint 1', project: name,
    goal: vision || 'Build something great',
    start_date: today, end_date: endDate, status: 'active'
  })

  // Create ONE first task (not 3 auto-generated ones)
  if (taskTitle) {
    await supabase.from('issues').insert({
      title: taskTitle,
      type: 'task',
      priority: 'high',
      assignee: 'builder',
      project: name,
      sprint: today,
      description: taskDescription || vision || '',
      acceptance_criteria: `${taskTitle} is complete and reviewed.`,
    })
  }

  // Save agent config to agents table
  if (agentName && business?.id) {
    await supabase.from('agents').insert({
      business_id: business.id,
      name: agentName,
      adapter: 'claude-code',
      model: model || 'anthropic/claude-sonnet-4-6',
      api_key_enc: apiKey || null,
      heartbeat_every: '4h',
      description: `First agent for ${name}`
    })
  }

  return NextResponse.json({ business, message: `${name} is ready!` })
}
