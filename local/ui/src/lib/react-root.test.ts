import { describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
import {
  getOrCreateToderoReactRoot,
  type ToderoReactRootHost,
} from "./react-root";

describe("getOrCreateToderoReactRoot", () => {
  it("reuses the existing root when the entry module runs again", () => {
    const host: ToderoReactRootHost = {};
    const container = {} as Parameters<typeof getOrCreateToderoReactRoot>[1];
    const root = { render: vi.fn(), unmount: vi.fn() } as unknown as Root;
    const createRoot = vi.fn(() => root);

    expect(getOrCreateToderoReactRoot(host, container, createRoot)).toBe(root);
    expect(getOrCreateToderoReactRoot(host, container, createRoot)).toBe(root);
    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(createRoot).toHaveBeenCalledWith(container);
  });
});
