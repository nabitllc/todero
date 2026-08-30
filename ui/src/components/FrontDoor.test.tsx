// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { FrontDoor } from "./FrontDoor";

describe("FrontDoor copy", () => {
  it("says create begins with a mission so the first screen matches the steps", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<FrontDoor onChoose={() => {}} />);
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("Build a new organization");
    expect(text).toMatch(/Begin with a mission/i);
    await act(async () => root.unmount());
    container.remove();
  });
});
