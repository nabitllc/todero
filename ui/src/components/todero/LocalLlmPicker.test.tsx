// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLocalLlmApi = vi.hoisted(() => ({
  detect: vi.fn(),
}));

vi.mock("@/api/local-llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/local-llm")>();
  return { ...actual, toderoLocalLlmApi: mockLocalLlmApi };
});

import { LocalLlmPicker, pickDefaultLocalLlmModel, type LocalLlmSelection } from "./LocalLlmPicker";
import type { LocalLlmRuntime } from "@/api/local-llm";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const leftover: LocalLlmSelection = {
  runtimeId: "ollama:127.0.0.1:11434",
  runtimeLabel: "Ollama",
  baseUrl: "http://127.0.0.1:11434",
  modelId: "llama3.2:latest",
};

const ollama: LocalLlmRuntime = {
  id: leftover.runtimeId,
  kind: "ollama",
  label: leftover.runtimeLabel,
  baseUrl: leftover.baseUrl,
  models: [{ id: leftover.modelId, label: leftover.modelId }],
};

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function mountPicker(value: LocalLlmSelection | null) {
  const onChange = vi.fn();
  const onRuntimesDetected = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <LocalLlmPicker value={value} onChange={onChange} onRuntimesDetected={onRuntimesDetected} />,
    );
  });
  await flushReact();
  return { root, onChange, onRuntimesDetected };
}

describe("LocalLlmPicker leftover pick", () => {
  beforeEach(() => {
    mockLocalLlmApi.detect.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("clears a leftover pick when live detect returns no runtimes", async () => {
    mockLocalLlmApi.detect.mockResolvedValue({ runtimes: [] });
    const { root, onChange, onRuntimesDetected } = await mountPicker(leftover);
    expect(onRuntimesDetected).toHaveBeenCalledWith([]);
    expect(onChange).toHaveBeenCalledWith(null);
    expect(document.body.textContent).toMatch(/No local LLM is running/i);
    await act(async () => root.unmount());
  });

  it("clears a leftover pick that is not in the live detect list", async () => {
    mockLocalLlmApi.detect.mockResolvedValue({
      runtimes: [
        {
          id: "lmstudio",
          kind: "lmstudio",
          label: "LM Studio",
          baseUrl: "http://127.0.0.1:1234",
          models: [{ id: "local-qwen", label: "local-qwen" }],
        },
      ],
    });
    const { root, onChange } = await mountPicker(leftover);
    expect(onChange).toHaveBeenCalledWith(null);
    await act(async () => root.unmount());
  });

  it("keeps a leftover pick that live detect currently contains", async () => {
    mockLocalLlmApi.detect.mockResolvedValue({ runtimes: [ollama] });
    const { root, onChange, onRuntimesDetected } = await mountPicker(leftover);
    expect(onRuntimesDetected).toHaveBeenCalledWith([ollama]);
    expect(onChange).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Ollama");
    await act(async () => root.unmount());
  });
});

describe("LocalLlmPicker native model select contrast", () => {
  beforeEach(() => {
    mockLocalLlmApi.detect.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses CSS that would fail if native <option> text were white-on-white", async () => {
    mockLocalLlmApi.detect.mockResolvedValue({ runtimes: [ollama] });
    const { root } = await mountPicker(leftover);
    const select = document.body.querySelector("select.todero-native-select");
    expect(select).toBeTruthy();
    expect(select?.querySelector("option")?.textContent).toContain("llama3.2");

    const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../index.css");
    const css = fs.readFileSync(cssPath, "utf8");
    expect(css).toMatch(/select\.todero-native-select\s*\{[^}]*color-scheme:\s*light/s);
    const optionBlock = css.match(/select\.todero-native-select option\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(optionBlock).toMatch(/color:\s*#111111/);
    expect(optionBlock).toMatch(/background-color:\s*#ffffff/);
    expect(optionBlock).not.toMatch(/^[ 	]*color:\s*(#fff|#ffffff|white|oklch\(1)/im);

    await act(async () => root.unmount());
  });
});

describe("pickDefaultLocalLlmModel", () => {
  it("prefers a 14B-class model when the runtime has one", () => {
    const models = [
      { id: "qwen2.5-coder:latest" },
      { id: "nemotron-32k:latest" },
      { id: "qwen2.5-coder:14b" },
      { id: "qwen2.5-coder:32b" },
    ];
    expect(pickDefaultLocalLlmModel(models)?.id).toBe("qwen2.5-coder:14b");
  });

  it("falls back to the first model otherwise, and to null with none", () => {
    expect(pickDefaultLocalLlmModel([{ id: "llama3.2:latest" }, { id: "phi4:latest" }])?.id).toBe("llama3.2:latest");
    expect(pickDefaultLocalLlmModel([])).toBeNull();
  });
});
