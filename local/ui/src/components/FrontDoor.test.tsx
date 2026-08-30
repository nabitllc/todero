// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { FrontDoor } from "./FrontDoor";

describe("FrontDoor copy", () => {
  it("does not say create begins with a mission when that step is skipped", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<FrontDoor onChoose={() => {}} />);
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("Build a new organization");
    expect(text).not.toMatch(/Begin with a mission/i);
    expect(text).toContain("Name your organization");
    await act(async () => root.unmount());
    container.remove();
  });
});
