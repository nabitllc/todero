// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ONBOARDING_STORAGE_KEY = "todero-onboarding-state";

const mockDialog = vi.hoisted(() => ({
  onboardingOpen: true,
  onboardingOptions: {} as { initialStep?: number; companyId?: string },
  closeOnboarding: vi.fn(),
  onboardingRouteDismissed: false,
  setOnboardingRouteDismissed: vi.fn(),
}));

const mockCompany = vi.hoisted(() => ({
  companies: [] as Array<{ id: string; name: string; issuePrefix: string }>,
  setSelectedCompanyId: vi.fn(),
  loading: false,
  error: null as Error | null,
}));

const mockAuthApi = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/auth")>();
  return { ...actual, authApi: { ...actual.authApi, getSession: mockAuthApi.getSession } };
});

const mockCompaniesApi = vi.hoisted(() => ({
  detachInflightList: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
}));
const mockGoalsApi = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(async () => []),
}));
const mockAgentsApi = vi.hoisted(() => ({
  adapterModels: vi.fn(async () => [] as Array<{ id: string; label: string }>),
  testEnvironment: vi.fn(
    async (): Promise<import("@todero/shared").AdapterEnvironmentTestResult> => ({
      adapterType: "claude_local",
      status: "fail",
      checks: [
        {
          code: "cli_missing",
          level: "error",
          message: "Claude Code CLI was not found.",
        },
      ],
      testedAt: new Date().toISOString(),
    }),
  ),
  hire: vi.fn(async () => ({ agent: { id: "agent-1" }, approval: null })),
  instructionsBundle: vi.fn(async () => ({ entryFile: "AGENTS.md" })),
  saveInstructionsFile: vi.fn(async () => ({})),
  getClaudeOAuthTokenStatus: vi.fn(),
  getAdapterAuthSignal: vi.fn(
    async (): Promise<import("@todero/shared").AdapterAuthSignalResponse> => ({
      status: "present",
    }),
  ),
}));
const mockAdapterBuild = vi.hoisted(() => ({
  buildAdapterConfig: vi.fn(() => ({}) as Record<string, unknown>),
}));
const mockEnvironmentsApi = vi.hoisted(() => ({
  list: vi.fn(async () => [] as Array<Record<string, unknown>>),
  capabilities: vi.fn(
    async (): Promise<import("@todero/shared").EnvironmentCapabilities> =>
      (await import("@todero/shared")).getEnvironmentCapabilities([]),
  ),
}));
const mockInstanceSettingsApi = vi.hoisted(() => ({
  get: vi.fn(async () => ({ defaultEnvironmentId: null as string | null })),
  getExperimental: vi.fn(async () => ({ enableManagedSandboxOnly: false })),
}));
const mockVaultApi = vi.hoisted(() => ({
  get: vi.fn(async () => ({
    settings: null,
    recommendedPath: "C:\\Users\\Public\\Todero Brain",
    recommendedExists: false,
    recommendedFromEnv: false,
    readPath: null,
    readPathExists: false,
    readOnly: true as const,
  })),
  save: vi.fn(async (input: { source: string }) => ({
    settings: { id: 1 as const, source: input.source, path: null, updatedAt: new Date().toISOString() },
    readPath: null,
    readPathExists: false,
    readOnly: true as const,
  })),
  ensureRecommended: vi.fn(async () => {
    throw new Error("Failed to clone Recommended Second Brain: git unavailable");
  }),
}));
const mockLocalLlmApi = vi.hoisted(() => ({
  detect: vi.fn(async () => ({ runtimes: [] as Array<Record<string, unknown>> })),
}));
const mockAdapterRegistry = vi.hoisted(() => ({
  list: [] as Array<{ type: string }>,
  disabled: new Set<string>(),
}));

vi.mock("@/lib/router", () => ({
  useLocation: () => ({ pathname: "/", search: "", hash: "", state: null }),
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));
vi.mock("../context/DialogContext", () => ({
  useDialog: () => mockDialog,
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompany,
}));
vi.mock("../api/companies", () => ({ companiesApi: mockCompaniesApi }));
vi.mock("../api/goals", () => ({ goalsApi: mockGoalsApi }));
vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("../api/approvals", () => ({ approvalsApi: { create: vi.fn() } }));
vi.mock("../api/issues", () => ({ issuesApi: { create: vi.fn() } }));
vi.mock("../api/projects", () => ({ projectsApi: { create: vi.fn(), list: vi.fn(async () => []) } }));
vi.mock("../api/environments", () => ({ environmentsApi: mockEnvironmentsApi }));
vi.mock("../api/instanceSettings", () => ({ instanceSettingsApi: mockInstanceSettingsApi }));
vi.mock("../api/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/vault")>();
  return { ...actual, toderoVaultApi: mockVaultApi };
});
vi.mock("@/api/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/vault")>();
  return { ...actual, toderoVaultApi: mockVaultApi };
});
vi.mock("../api/local-llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/local-llm")>();
  return { ...actual, toderoLocalLlmApi: mockLocalLlmApi };
});
vi.mock("@/api/local-llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/local-llm")>();
  return { ...actual, toderoLocalLlmApi: mockLocalLlmApi };
});
vi.mock("../adapters", () => ({
  listUIAdapters: () => mockAdapterRegistry.list,
  getUIAdapter: () => ({ buildAdapterConfig: mockAdapterBuild.buildAdapterConfig }),
}));
vi.mock("../adapters/metadata", () => ({ isVisualAdapterChoice: () => true }));
vi.mock("../adapters/adapter-display-registry", () => ({
  getAdapterDisplay: (type: string) => ({
    type,
    recommended: type === "claude_local" || type === "codex_local",
    label: type === "claude_local" ? "Claude Code" : type === "codex_local" ? "Codex" : type,
    description: "",
    icon: () => null,
  }),
  getAdapterLabel: (type: string) => type,
  getAdapterLabels: () => ({}) as Record<string, string>,
  isKnownAdapterType: () => true,
}));
vi.mock("../adapters/use-disabled-adapters", () => ({
  useDisabledAdaptersSync: () => mockAdapterRegistry.disabled,
  useAdapterRegistryLoaded: () => true,
}));
vi.mock("../adapters/use-adapter-capabilities", () => ({
  useAdapterCapabilities: () => () => ({
    supportsInstructionsBundle: false,
    supportsSkills: false,
    supportsLocalAgentJwt: false,
    requiresMaterializedRuntimeSkills: false,
    supportsModelProfiles: false,
  }),
}));
vi.mock("./AsciiArtAnimation", () => ({ AsciiArtAnimation: () => null }));
vi.mock("./FrontDoor", () => ({ FrontDoor: () => null }));
vi.mock("./AgentCapsule", () => ({ AgentCapsule: () => null }));

import { ApiError } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { ONBOARDING_STORAGE_KEY as EXPORTED_KEY, OnboardingWizard } from "./OnboardingWizard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function setControlledValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function buttons() {
  return [...document.body.querySelectorAll("button")];
}

function buttonByText(match: (t: string) => boolean) {
  return buttons().find((b) => match(b.textContent?.trim() ?? "")) ?? null;
}

async function clickByText(match: (t: string) => boolean) {
  const el = buttonByText(match);
  if (!el) throw new Error(`No button matching ${match}`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flushReact();
}

function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(queryKeys.auth.session, {
    session: { id: "session-1", userId: "user-1" },
    user: { id: "user-1", name: "Example", email: "user-1@example.com", image: null },
  });
  return { container, root, queryClient };
}

async function mount() {
  const ctx = render();
  await act(async () => {
    ctx.root.render(
      <QueryClientProvider client={ctx.queryClient}>
        <OnboardingWizard />
      </QueryClientProvider>,
    );
  });
  await flushReact();
  return ctx;
}

describe("OnboardingWizard first-run LLM lock", () => {
  beforeEach(() => {
    mockAuthApi.getSession.mockResolvedValue({
      session: { id: "session-1", userId: "user-1" },
      user: { id: "user-1", name: "Example", email: "user-1@example.com", image: null },
    });
    window.localStorage.clear();
    mockDialog.onboardingOpen = true;
    mockDialog.onboardingOptions = {};
    mockCompany.companies = [{ id: "company-1", name: "Initech", issuePrefix: "INI" }];
    mockCompany.loading = false;
    mockCompaniesApi.list.mockResolvedValue(mockCompany.companies);
    mockAgentsApi.getClaudeOAuthTokenStatus.mockRejectedValue(new ApiError("missing", 404, null));
    mockAdapterRegistry.list = [{ type: "claude_local" }, { type: "codex_local" }];
    mockAdapterRegistry.disabled = new Set();
    mockAgentsApi.testEnvironment.mockResolvedValue({
      adapterType: "claude_local",
      status: "fail",
      checks: [
        { code: "cli_missing", level: "error", message: "Claude Code CLI was not found." },
      ],
      testedAt: new Date().toISOString(),
    });
    mockAgentsApi.hire.mockClear();
    mockVaultApi.get.mockClear();
    mockVaultApi.save.mockClear();
    mockLocalLlmApi.detect.mockResolvedValue({ runtimes: [] });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("exports the same onboarding storage key the rest of the suite uses", () => {
    expect(EXPORTED_KEY).toBe(ONBOARDING_STORAGE_KEY);
  });

  async function openConnectStep() {
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        step: 4,
        onboardingPath: "create",
        companyName: "Initech",
        companyGoal: "Ship the marketplace",
        agentName: "Ada",
        createdCompanyId: "company-1",
        adapterType: "claude_local",
      }),
    );
    return mount();
  }

  it("(a) Start stays blocked without a connected LLM and the screen says they must connect one", async () => {
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        step: 6,
        onboardingPath: "create",
        companyName: "Initech",
        companyGoal: "Ship the marketplace",
        agentName: "Ada",
        createdCompanyId: "company-1",
        createdAgentId: "agent-1",
        adapterType: "claude_local",
        llmConnected: false,
      }),
    );
    const { root } = await mount();
    await flushReact();

    expect(document.body.textContent).toMatch(/must connect/i);
    const start = buttonByText((t) => t === "Get started" || t.startsWith("Get started"));
    expect(start).not.toBeNull();
    expect(start!.disabled).toBe(true);
    expect(mockAgentsApi.hire).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it("(d) Local LLM card appears next to Claude Code / Codex, and Skip is gone from Connect a model", async () => {
    const { root } = await openConnectStep();
    await flushReact();

    expect(document.body.textContent).toContain("Connect a model");
    expect(document.body.textContent).toContain("Local LLM");
    expect(document.body.textContent).toContain("Claude Code");
    expect(document.body.textContent).toContain("Codex");
    const skip = buttonByText((t) => t === "Skip");
    expect(skip).toBeNull();

    await clickByText((t) => t.includes("Local LLM"));
    await flushReact();
    expect(document.body.textContent).toMatch(/No local LLM is running/i);

    await act(async () => root.unmount());
  });

  it("(b)(c) Second Brain offers None (not Skip) and still has Back", async () => {
    mockAgentsApi.testEnvironment.mockResolvedValue({
      adapterType: "claude_local",
      status: "pass",
      checks: [],
      testedAt: new Date().toISOString(),
    });
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        step: 4,
        onboardingPath: "create",
        companyName: "Initech",
        companyGoal: "Ship the marketplace",
        agentName: "Ada",
        createdCompanyId: "company-1",
        adapterType: "claude_local",
      }),
    );
    const { root } = await mount();
    await flushReact();

    await clickByText((t) => t.startsWith("Connect"));
    for (let i = 0; i < 12; i++) {
      await flushReact();
      if (buttonByText((t) => t.includes("No Second Brain attached"))) break;
    }

    expect(document.body.textContent).toContain("Second Brain");
    const none = buttonByText((t) => t.includes("No Second Brain attached"));
    expect(none).not.toBeNull();
    expect(buttonByText((t) => t === "Skip")).toBeNull();
    expect(buttonByText((t) => t.trim() === "None")).toBeNull();
    const back = buttonByText((t) => t === "Back" || t.includes("Back"));
    expect(back).not.toBeNull();

    await clickByText((t) => t.includes("No Second Brain attached"));
    await flushReact();
    await clickByText((t) => t === "Continue" || t.startsWith("Continue"));
    await flushReact();
    expect(mockVaultApi.save).toHaveBeenCalledWith(
      expect.objectContaining({ source: "none" }),
    );

    await act(async () => root.unmount());
  });

  it("(e) missing Recommended cannot continue as attached", async () => {
    mockAgentsApi.testEnvironment.mockResolvedValue({
      adapterType: "claude_local",
      status: "pass",
      checks: [],
      testedAt: new Date().toISOString(),
    });
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        step: 5,
        onboardingPath: "create",
        companyName: "Initech",
        companyGoal: "Ship the marketplace",
        agentName: "Ada",
        createdCompanyId: "company-1",
        createdAgentId: "agent-1",
        adapterType: "claude_local",
        llmConnected: true,
      }),
    );
    const { root } = await mount();
    for (let i = 0; i < 12; i++) {
      await flushReact();
      if (/missing/i.test(document.body.textContent ?? "") && buttonByText((t) => t === "Continue")) break;
    }

    expect(document.body.textContent).toMatch(/missing/i);
    const continueBtn = buttonByText((t) => t === "Continue");
    expect(continueBtn).not.toBeNull();
    expect(continueBtn!.disabled).toBe(true);
    expect(mockVaultApi.save).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  const leftoverPick = {
    runtimeId: "ollama:127.0.0.1:11434",
    runtimeLabel: "Ollama",
    baseUrl: "http://127.0.0.1:11434",
    modelId: "llama3.2:latest",
  };

  async function openLocalLlmConnectStep(selection = leftoverPick) {
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        step: 4,
        onboardingPath: "create",
        companyName: "Initech",
        companyGoal: "Ship the marketplace",
        agentName: "Ada",
        createdCompanyId: "company-1",
        adapterType: "claude_local",
        connectKind: "local_llm",
        localLlmSelection: selection,
      }),
    );
    return mount();
  }

  function connectButton() {
    return (
      buttonByText((t) => t.trim() === "Connect") ??
      buttonByText((t) => t.replace(/\s+/g, " ").trim() === "Connect")
    );
  }

  it("empty detect clears a leftover pick and keeps Connect disabled", async () => {
    mockLocalLlmApi.detect.mockResolvedValue({ runtimes: [] });
    const { root } = await openLocalLlmConnectStep();
    for (let i = 0; i < 8; i++) {
      await flushReact();
      if (/No local LLM is running/i.test(document.body.textContent ?? "")) break;
    }

    expect(document.body.textContent).toMatch(/No local LLM is running/i);
    const connect = connectButton();
    expect(connect).not.toBeNull();
    expect(connect!.disabled).toBe(true);

    const stored = JSON.parse(window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? "{}");
    expect(stored.localLlmSelection).toBeNull();

    await act(async () => root.unmount());
  });

  it("Connect stays disabled when leftover pick is not in the live detect list", async () => {
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
    const { root } = await openLocalLlmConnectStep();
    for (let i = 0; i < 8; i++) {
      await flushReact();
      if ((document.body.textContent ?? "").includes("LM Studio")) break;
    }

    const connect = connectButton();
    expect(connect).not.toBeNull();
    expect(connect!.disabled).toBe(true);
    const stored = JSON.parse(window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? "{}");
    expect(stored.localLlmSelection).toBeNull();

    await act(async () => root.unmount());
  });

  it("Connect enables only when live detect currently contains the leftover runtime+model", async () => {
    mockLocalLlmApi.detect.mockResolvedValue({
      runtimes: [
        {
          id: leftoverPick.runtimeId,
          kind: "ollama",
          label: leftoverPick.runtimeLabel,
          baseUrl: leftoverPick.baseUrl,
          models: [{ id: leftoverPick.modelId, label: leftoverPick.modelId }],
        },
      ],
    });
    const { root } = await openLocalLlmConnectStep();
    for (let i = 0; i < 8; i++) {
      await flushReact();
      const connect = connectButton();
      if (connect && !connect.disabled) break;
    }

    const connect = connectButton();
    expect(connect).not.toBeNull();
    expect(connect!.disabled).toBe(false);
    const stored = JSON.parse(window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? "{}");
    expect(stored.localLlmSelection).toEqual(leftoverPick);

    await act(async () => root.unmount());
  });

});
