import { NextResponse } from 'next/server'
import { assertDbConfigured, db } from '@/lib/db'

function getSupabase() {
  // db() throws a DbConfigurationError naming the exact missing variables.
  assertDbConfigured()
  return db()
}

// Static registry of human workspace members
// Extend this map as new humans join the workspace
const HUMAN_MEMBERS: Record<string, {
  id: string
  name: string
  emoji: string
  role: string
  joinDate: string
}> = {
  michael: {
    id: 'michael',
    name: 'Michael',
    emoji: '👤',
    role: 'Founder & CEO',
    joinDate: '2025-01-01',
  },
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const member = HUMAN_MEMBERS[id]
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  let supabase
  try {
    supabase = getSupabase()
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  // Single query: fetch recent issues touched by this member (assignee = id)
  // Ordered by updated_at DESC — covers both assigned issues and recent activity
  const { data: issues, error } = await supabase
    .from('issues')
    .select('id,task_key,title,status,priority,type,project,updated_at,created_at,assignee')
    .eq('assignee', id)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const allIssues = issues ?? []

  // Assigned issues: currently active (not done/cancelled)
  const DONE_STATUSES = new Set(['done', 'closed', 'cancelled', 'released', 'completed'])
  const assignedIssues = allIssues.filter(i => !DONE_STATUSES.has(i.status))

  // Activity feed: last 20 issues sorted by updated_at (most recent first)
  const activityFeed = allIssues.slice(0, 20).map(i => ({
    id: i.id,
    task_key: i.task_key,
    title: i.title,
    status: i.status,
    project: i.project,
    updated_at: i.updated_at,
  }))

  return NextResponse.json({
    member,
    assignedIssues,
    activityFeed,
  })
}
