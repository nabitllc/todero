"use client";
/**
 * AgentOffice — main entry point
 * INF-125: Refactored to import from sub-modules
 *
 * Extracted modules:
 *  - components/office/officeConstants.ts  — static data, layout config, agent definitions
 *  - components/office/officeHelpers.ts    — pure utility functions (tileCenterPx, initAgents, etc.)
 *  - components/office/officeDrawing.ts    — canvas drawing functions (drawFloor, drawAgent, etc.)
 *  - hooks/useAgentStatus.ts               — Supabase agent_runs + board task polling
 *
 * The core simulation/rendering/JSX logic lives in AgentOfficeCore.tsx.
 * This file provides the public API surface for page imports.
 */

// Re-export everything from core for backward compatibility
export { default } from './AgentOfficeCore';
