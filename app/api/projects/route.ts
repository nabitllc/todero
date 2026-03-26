import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'data', 'projects.json')
    const raw = fs.readFileSync(filePath, 'utf-8')
    const projects = JSON.parse(raw)
    return NextResponse.json(projects, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json([], { status: 500 })
  }
}
