/**
 * Tests for office constants module (INF-153)
 * Verifies static data structure integrity
 *
 * MEETINGS and AGENT_TASKS were removed under kill-office-fiction: they backed
 * a co-activity meeting inference and canned task-name generator that fabricated
 * activity the office never actually observed. See officeConstants.ts.
 *
 * TOD (agent-roster-truth): ALL_AGENTS/ACTIVE_IDS/BENCH_IDS/DEPENDENCIES/
 * DESK_POS/BENCH_POS/ORCHESTRATOR_ID were a hardcoded 8-agent roster with a
 * literal id → desk-position table. All of it is gone — the office now
 * builds its roster from the real /api/agents response (initAgents() in
 * officeDrawing.ts) and this module holds only pure layout geometry:
 * deskSlot(i)/benchSlot(i) generate a position for the Nth agent, for any N.
 */
import {
  deskSlot,
  benchSlot,
  MAP_COLS,
  MAP_ROWS,
} from '../components/office/officeConstants';

describe('officeConstants', () => {
  describe('deskSlot', () => {
    it('returns a numeric tile position for any index', () => {
      for (let i = 0; i < 20; i++) {
        const { tx, ty } = deskSlot(i);
        expect(typeof tx).toBe('number');
        expect(typeof ty).toBe('number');
      }
    });

    it('never collides — every slot in a run of 16 is unique', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 16; i++) {
        const { tx, ty } = deskSlot(i);
        const key = `${tx},${ty}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });
  });

  describe('benchSlot', () => {
    it('returns a numeric tile position for any index', () => {
      for (let i = 0; i < 20; i++) {
        const { tx, ty } = benchSlot(i);
        expect(typeof tx).toBe('number');
        expect(typeof ty).toBe('number');
      }
    });

    it('never collides — every slot in a run of 12 is unique', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 12; i++) {
        const { tx, ty } = benchSlot(i);
        const key = `${tx},${ty}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });
  });

  describe('MAP constants', () => {
    it('MAP_COLS and MAP_ROWS should be positive', () => {
      expect(MAP_COLS).toBeGreaterThan(0);
      expect(MAP_ROWS).toBeGreaterThan(0);
    });
  });
});
