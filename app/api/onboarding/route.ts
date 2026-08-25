import { NextResponse } from 'next/server'
import { db, type DbAdapter } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'
import { resolveConfiguredModel } from '@/lib/llm-provider'

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
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const { name, type, vision, agentName, model, apiKey, taskTitle, taskDescription } = await req.json()
  if (!name || !type) return NextResponse.json({ error: 'name and type required' }, { status: 400 })

  // Validated BEFORE the first write. The wizard's model used to default to
  // `anthropic/claude-sonnet-4-6`, stamping every first agent with a model the
  // install could not reach; rejecting it later would leave an orphan business
  // and sprint behind, so the check happens while nothing has been created yet.
  let agentModel: string | null = null
  if (agentName) {
    const resolved = await resolveConfiguredModel(model)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error, id: resolved.id }, { status: resolved.status })
    }
    agentModel = resolved.model
  }

  const supabase = getSupabase()

  // Create business
  const { data: business, error: bErr } = await supabase
    .from('businesses').insert({ name, type, owner: WORKSPACE_OWNER, status: 'active' }).select().single()
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 })

  // Every write below is best-effort in the sense that a failure here
  // shouldn't unwind the business already created — but it must not be
  // invisible either. Collect failures and report them alongside the
  // success message instead of a blanket "$name is ready!" that assumes
  // sprint/task/agent all landed when one silently didn't.
  const warnings: string[] = []

  // Create first sprint
  const today = new Date().toISOString().split('T')[0]
  const endDate = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
  const { error: sprintErr } = await supabase.from('sprints').insert({
    name: 'Sprint 1', project: name,
    goal: vision || 'Build something great',
    start_date: today, end_date: endDate, status: 'active'
  })
  if (sprintErr) {
    console.error(`[onboarding] sprint insert failed for business ${business?.id}: ${sprintErr.message}`)
    warnings.push(`Sprint 1 was not created: ${sprintErr.message}`)
  }

  // Create ONE first task (not 3 auto-generated ones)
  if (taskTitle) {
    const { error: taskErr } = await supabase.from('issues').insert({
      title: taskTitle,
      type: 'task',
      priority: 'high',
      assignee: 'builder',
      project: name,
      sprint: today,
      description: taskDescription || vision || '',
      acceptance_criteria: `${taskTitle} is complete and reviewed.`,
    })
    if (taskErr) {
      console.error(`[onboarding] first task insert failed for business ${business?.id}: ${taskErr.message}`)
      warnings.push(`First task "${taskTitle}" was not created: ${taskErr.message}`)
    }
  }

  // Save agent config to agents table — with the model resolved above.
  if (agentName && agentModel && business?.id) {
    const { error: agentErr } = await supabase.from('agents').insert({
      business_id: business.id,
      name: agentName,
      adapter: 'claude-code',
      model: agentModel,
      api_key_enc: apiKey || null,
      heartbeat_every: '4h',
      description: `First agent for ${name}`
    })
    if (agentErr) {
      console.error(`[onboarding] agent insert failed for business ${business?.id}: ${agentErr.message}`)
      warnings.push(`Agent "${agentName}" was not created: ${agentErr.message}`)
    }
  }

  return NextResponse.json({
    business,
    message: warnings.length === 0
      ? `${name} is ready!`
      : `${name} was created, but with ${warnings.length} problem(s) — see warnings.`,
    ...(warnings.length > 0 ? { warnings } : {}),
  })
}
