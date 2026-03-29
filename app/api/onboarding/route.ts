import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
)

export async function POST(req: Request) {
  const { name, type, goal, agents, targetDate, successMetric, tagline } = await req.json()
  if (!name || !type) return NextResponse.json({ error: 'name and type required' }, { status: 400 })

  // Create business
  const { data: business, error: bErr } = await supabase
    .from('businesses').insert({
      name, type,
      owner: 'michael@nabit.app',
      status: 'active',
      ...(tagline ? { description: tagline } : {}),
    }).select().single()
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 })

  // Create first sprint with goal + metric
  const today = new Date().toISOString().split('T')[0]
  const sprintEndDate = targetDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
  const { data: sprint } = await supabase.from('sprints').insert({
    name: 'Sprint 1',
    project: name,
    goal: goal || 'Ship first feature',
    start_date: today,
    end_date: sprintEndDate,
    status: 'active',
    ...(successMetric ? { success_metric: successMetric } : {}),
  }).select().single()

  // Create 3 starter issues
  const starters = [
    {
      title: `Define first feature for ${name}`,
      type: 'feature',
      priority: 'high',
      assignee: 'builder',
      project: name,
      sprint: today,
      description: `First feature to build for ${name}.\n\nGoal: ${goal || ''}`,
      acceptance_criteria: 'Feature defined with description and acceptance criteria.',
    },
    {
      title: `Set up ${name} project structure`,
      type: 'task',
      priority: 'medium',
      assignee: 'builder',
      project: name,
      sprint: today,
      description: `Initial project setup for ${name}.`,
      acceptance_criteria: 'Project folder and basic structure created.',
    },
    {
      title: `Configure agents for ${name}`,
      type: 'ops',
      priority: 'medium',
      assignee: 'ops',
      project: name,
      sprint: today,
      description: `Configure selected agents: ${(agents || []).join(', ')}`,
      acceptance_criteria: 'Agents assigned to project.',
    },
  ]
  await supabase.from('issues').insert(starters)

  // Create welcome issue
  const { error: welcomeErr } = await supabase.from('issues').insert({
    title: `Welcome to ${name}! Start here.`,
    type: 'task',
    priority: 'high',
    assignee: 'main',
    project: name,
    sprint: today,
    description: goal
      ? `Welcome to ${name}!\n\nYour mission: ${goal}${successMetric ? `\nSuccess metric: ${successMetric}` : ''}${targetDate ? `\nTarget date: ${targetDate}` : ''}`
      : `Welcome to ${name}! Your first sprint is ready. Start by defining your first feature.`,
    acceptance_criteria: `Team onboarded and ready to build ${name}.`,
  })
  if (welcomeErr) console.error('Welcome issue error:', welcomeErr)

  return NextResponse.json({
    business,
    sprint,
    message: `${name} is ready! Sprint 1 started.`,
  })
}
