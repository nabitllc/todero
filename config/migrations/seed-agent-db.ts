#!/usr/bin/env npx ts-node
// Run: npx ts-node config/migrations/seed-agent-db.ts
// Seeds agent_documents and agent_memory from the filesystem into the database.
// Idempotent — safe to run multiple times.

import fs from 'fs'
import path from 'path'
// Relative (not '@/lib/paths') so `npx ts-node` resolves it without the Next.js
// path aliases.
import { CONFIG_DIR, TODERO_DIR } from '../../lib/paths'
import { db, dbMissingEnv } from '../../lib/db'

const CONFIG = CONFIG_DIR
const TODERO = TODERO_DIR

const missing = dbMissingEnv()
if (missing.length > 0) {
  console.error(`Database is not configured. Missing: ${missing.join(', ')}. Set them in .env.local.`)
  process.exit(1)
}

function readIfExists(p: string): string {
  try { return fs.readFileSync(p, 'utf8') } catch { return '' }
}

async function upsertDoc(agent_id: string, doc_type: string, slug: string, filePath: string) {
  const content = readIfExists(filePath)
  if (!content) { console.log(`  skip (empty): ${filePath}`); return }
  const { error } = await db()
    .from('agent_documents')
    .upsert({ agent_id, doc_type, slug, content, updated_by: 'seed' })
  if (error) {
    console.error(`  error upserting ${agent_id}/${doc_type}/${slug}:`, error.message)
  } else {
    console.log(`  ✓ ${agent_id}/${doc_type}/${slug}`)
  }
}

async function upsertMemory(agent_id: string, memory_type: string, date_key: string | null, content: string) {
  if (!content.trim()) return
  const { error } = await db()
    .from('agent_memory_files')
    .upsert({ agent_id, memory_type, date_key, content })
  if (error) {
    console.error(`  error upserting memory ${agent_id}/${memory_type}/${date_key}:`, error.message)
  } else {
    console.log(`  ✓ memory ${agent_id}/${memory_type}/${date_key ?? 'null'}`)
  }
}

async function main() {
  console.log('Seeding agent_documents...')

  // Global docs
  await upsertDoc('global', 'soul',   'SOUL',   `${CONFIG}/SOUL.md`)
  await upsertDoc('global', 'agents', 'AGENTS', `${CONFIG}/AGENTS.md`)

  // Per-agent souls
  const agents = ['builder', 'tester', 'designer', 'po', 'scout', 'ops', 'deployer', 'auditor', 'kemuni-sme', 'vespera-sme', 'todero-sme', 'infra-sme']
  for (const agent of agents) {
    const soulPath = `${TODERO}/workspace-${agent}/SOUL.md`
    if (fs.existsSync(soulPath)) {
      await upsertDoc(agent, 'soul', 'SOUL', soulPath)
    }
    const hbPath = `${TODERO}/workspace-${agent}/HEARTBEAT.md`
    if (fs.existsSync(hbPath)) {
      await upsertDoc(agent, 'heartbeat', 'HEARTBEAT', hbPath)
    }
  }

  // Skills
  const skillsDir = `${CONFIG}/skills`
  if (fs.existsSync(skillsDir)) {
    const skillDirs = fs.readdirSync(skillsDir)
    for (const dir of skillDirs) {
      const skillFile = path.join(skillsDir, dir, 'SKILL.md')
      if (fs.existsSync(skillFile)) {
        await upsertDoc('skill', 'skill', dir, skillFile)
      }
    }
  }

  console.log('\nSeeding agent_memory...')

  // Daily memory files
  const memDir = `${CONFIG}/memory`
  if (fs.existsSync(memDir)) {
    const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md')).sort()
    for (const f of files) {
      const dateKey = f.replace('.md', '').slice(0, 10)
      const content = readIfExists(path.join(memDir, f))
      await upsertMemory('global', 'daily', dateKey, content)
    }
  }

  // Long-term memory
  const ltContent = readIfExists(`${CONFIG}/MEMORY.md`)
  if (ltContent) await upsertMemory('global', 'long_term', null, ltContent)

  // Self-improving
  const siContent = readIfExists(`${CONFIG}/self-improving/memory.md`)
  if (siContent) await upsertMemory('global', 'self_improving', null, siContent)

  // Corrections
  const corrContent = readIfExists(`${CONFIG}/self-improving/corrections.md`)
  if (corrContent) await upsertMemory('global', 'corrections', null, corrContent)

  // Session state
  const ssContent = readIfExists(`${CONFIG}/self-improving/session-state.md`)
  if (ssContent) await upsertMemory('global', 'session_state', null, ssContent)

  console.log('\nDone.')
}

main().catch(console.error)
