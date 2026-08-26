/**
 * officeHelpers.ts — re-exports pure utility functions from officeDrawing.ts
 *
 * The test suite (INF-153) imports from this path. All helpers live in
 * officeDrawing.ts so we re-export them here to keep the module boundary
 * clear without duplicating logic.
 */
export { tileCenterPx, fmt, clamp, mkBurst, countWaitingByAgent } from './officeDrawing';
