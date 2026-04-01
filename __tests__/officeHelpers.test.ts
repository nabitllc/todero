/**
 * Tests for office helper utilities (INF-153)
 */
import { tileCenterPx, fmt, clamp, mkBurst } from '../components/office/officeHelpers';

describe('officeHelpers', () => {
  describe('tileCenterPx', () => {
    it('should return center coordinates for a tile', () => {
      const result = tileCenterPx(0, 0, 64);
      expect(result.x).toBe(32);
      expect(result.y).toBe(32);
    });

    it('should handle non-zero tile positions', () => {
      const result = tileCenterPx(2, 3, 64);
      expect(result.x).toBe(160); // (2+0.5)*64
      expect(result.y).toBe(224); // (3+0.5)*64
    });

    it('should scale correctly with different tile sizes', () => {
      const result = tileCenterPx(1, 1, 100);
      expect(result.x).toBe(150);
      expect(result.y).toBe(150);
    });
  });

  describe('fmt', () => {
    it('should pad single digit numbers with zero', () => {
      expect(fmt(5)).toBe('05');
      expect(fmt(0)).toBe('00');
      expect(fmt(9)).toBe('09');
    });

    it('should not pad double digit numbers', () => {
      expect(fmt(10)).toBe('10');
      expect(fmt(59)).toBe('59');
      expect(fmt(23)).toBe('23');
    });
  });

  describe('clamp', () => {
    it('should return the value when within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('should return lo when below range', () => {
      expect(clamp(-1, 0, 10)).toBe(0);
    });

    it('should return hi when above range', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('should handle equal lo and hi', () => {
      expect(clamp(5, 5, 5)).toBe(5);
    });
  });

  describe('mkBurst', () => {
    it('should return 12 particles', () => {
      const particles = mkBurst(100, 100, '#ff0000');
      expect(particles.length).toBe(12);
    });

    it('each particle should have required fields', () => {
      const particles = mkBurst(50, 75, '#00ff88');
      particles.forEach(p => {
        expect(p.x).toBe(50);
        expect(p.y).toBe(75);
        expect(p.color).toBe('#00ff88');
        expect(typeof p.vx).toBe('number');
        expect(typeof p.vy).toBe('number');
        expect(p.age).toBe(0);
        expect(p.maxAge).toBeGreaterThan(0);
        expect(p.size).toBeGreaterThan(0);
      });
    });
  });
});
