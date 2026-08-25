// INF-222: Theme selector — API routes
import { NextRequest, NextResponse } from 'next/server'
import { getThemePreference, setThemePreference, THEMES } from '@/lib/theme'
import type { ThemeId } from '@/lib/theme'
import { dbQueryErrorResponse } from '@/lib/db-http'

export async function GET() {
  const themeId = await getThemePreference()
  return NextResponse.json({ themeId, theme: THEMES[themeId], available: THEMES })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { themeId } = body

  if (!themeId || !(themeId in THEMES)) {
    return NextResponse.json(
      { error: `Invalid themeId. Must be one of: ${Object.keys(THEMES).join(', ')}` },
      { status: 422 }
    )
  }

  const { error } = await setThemePreference(themeId as ThemeId)
  if (error) return dbQueryErrorResponse(error, 'agent_memory')
  return NextResponse.json({ themeId, theme: THEMES[themeId as ThemeId] })
}
