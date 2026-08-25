/**
 * Tests for office constants module (INF-153)
 * Verifies static data structure integrity
 *
 * MEETINGS and AGENT_TASKS were removed under kill-office-fiction: they backed
 * a co-activity meeting inference and canned task-name generator that fabricated
 * activity the office never actually observed. See officeConstants.ts.
 */
import {
  ALL_AGENTS,
  ACTIVE_IDS,
  BENCH_IDS,
  DEPENDENCIES,
  DESK_POS,
  BENCH_POS,
  MAP_COLS,
  MAP_ROWS,
  ORCHESTRATOR_ID,
} from '../components/office/officeConstants';

describe('officeConstants', () => {
  describe('ALL_AGENTS', () => {
    it('should have 8 agents', () => {
      expect(ALL_AGENTS.length).toBe(8);
    });

    it('each agent should have required fields', () => {
      ALL_AGENTS.forEach(agent => {
        expect(agent.id).toBeTruthy();
        expect(agent.name).toBeTruthy();
        expect(agent.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(agent.emoji).toBeTruthy();
        expect(agent.role).toBeTruthy();
        expect(agent.personality.workBurst).toBeGreaterThan(0);
        expect(agent.personality.focusDuration).toBeGreaterThan(0);
      });
    });

    it('should have unique agent IDs', () => {
      const ids = ALL_AGENTS.map(a => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('ACTIVE_IDS and BENCH_IDS', () => {
    it('ACTIVE_IDS should have 5 agents', () => {
      expect(ACTIVE_IDS.length).toBe(5);
    });

    it('BENCH_IDS should have 3 agents', () => {
      expect(BENCH_IDS.length).toBe(3);
    });

    it('ORCHESTRATOR_ID should be in ACTIVE_IDS', () => {
      expect(ACTIVE_IDS).toContain(ORCHESTRATOR_ID);
    });

    it('no overlap between ACTIVE_IDS and BENCH_IDS', () => {
      const overlap = ACTIVE_IDS.filter(id => BENCH_IDS.includes(id));
      expect(overlap).toHaveLength(0);
    });
  });

  describe('DEPENDENCIES', () => {
    it('all dependency source agents should be in ALL_AGENTS', () => {
      Object.keys(DEPENDENCIES).forEach(id => {
        expect(ALL_AGENTS.find(a => a.id === id)).toBeTruthy();
      });
    });

    it('all dependency target agents should be in ALL_AGENTS', () => {
      Object.values(DEPENDENCIES).flat().forEach(id => {
        expect(ALL_AGENTS.find(a => a.id === id)).toBeTruthy();
      });
    });
  });

  describe('DESK_POS', () => {
    it('all ACTIVE_IDS should have desk positions', () => {
      ACTIVE_IDS.forEach(id => {
        expect(DESK_POS[id]).toBeDefined();
        expect(typeof DESK_POS[id].tx).toBe('number');
        expect(typeof DESK_POS[id].ty).toBe('number');
      });
    });
  });

  describe('BENCH_POS', () => {
    it('all BENCH_IDS should have bench positions', () => {
      BENCH_IDS.forEach(id => {
        expect(BENCH_POS[id]).toBeDefined();
        expect(typeof BENCH_POS[id].tx).toBe('number');
        expect(typeof BENCH_POS[id].ty).toBe('number');
      });
    });
  });

  describe('MAP constants', () => {
    it('MAP_COLS and MAP_ROWS should be positive', () => {
      expect(MAP_COLS).toBeGreaterThan(0);
      expect(MAP_ROWS).toBeGreaterThan(0);
    });
  });
});
