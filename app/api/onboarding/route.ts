import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
)

export async function POST(req: Request) {
  const { name, type, vision, agentName, model, apiKey, taskTitle, taskDescription } = await req.json()
  if (!name || !type) return NextResponse.json({ error: 'name and type required' }, { status: 400 })

  // Create business
  const { data: business, error: bErr } = await supabase
    .from('businesses').insert({ name, type, owner: 'michael@nabit.app', status: 'active' }).select().single()
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

  // Store agent config in a simple JSON log for now (agents table TBD)
  console.log('Agent config:', { businessId: business.id, agentName, model, hasKey: !!apiKey })

  return NextResponse.json({ business, message: `${name} is ready!` })
}
