import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const PATH = '/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'

export async function POST() {
  const log: string[] = []

  try {
    // Step 1: Run doctor --fix
    const doctor = await execAsync('/opt/homebrew/bin/openclaw doctor --fix 2>&1', {
      timeout: 15000,
      env: { ...process.env, PATH },
    })
    log.push(`doctor: ${doctor.stdout.trim().slice(0, 300)}`)
  } catch (e: any) {
    log.push(`doctor error: ${e.message}`)
  }

  try {
    // Step 2: Restart gateway
    const restart = await execAsync('/opt/homebrew/bin/openclaw gateway restart 2>&1', {
      timeout: 15000,
      env: { ...process.env, PATH },
    })
    log.push(`restart: ${restart.stdout.trim().slice(0, 300)}`)
  } catch (e: any) {
    log.push(`restart error: ${e.message}`)
  }

  // Step 3: Wait for gateway to come up
  await new Promise(r => setTimeout(r, 8000))

  // Step 4: Check status
  let running = false
  try {
    const status = await execAsync('/opt/homebrew/bin/openclaw gateway status 2>&1', {
      timeout: 10000,
      env: { ...process.env, PATH },
    })
    running = status.stdout.includes('running')
    log.push(`status: ${status.stdout.trim().slice(0, 200)}`)
  } catch (e: any) {
    log.push(`status error: ${e.message}`)
  }

  return NextResponse.json({ success: running, running, log })
}
