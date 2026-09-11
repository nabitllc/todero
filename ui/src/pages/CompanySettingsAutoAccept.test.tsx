// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryKeys } from "@/lib/queryKeys";
import { CompanySettings } from "./CompanySettings";

const mockCompaniesApi = vi.hoisted(() => ({
  update: vi.fn(),
  archive: vi.fn(),
}));

const mockAssetsApi = vi.hoisted(() => ({ uploadCompanyLogo: vi.fn() }));
const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());
const mockSetSelectedCompanyId = vi.hoisted(() => vi.fn());
const selectedCompany = vi.hoisted(() => ({
  current: {
    id: "company-1",
    name: "Acme Robotics",
    description: null,
    status: "active",
    issuePrefix: "ACM",
    brandColor: null,
    logoUrl: null,
    attachmentMaxBytes: null,
    requireBoardApprovalForNewAgents: false,
    interactionResolverGovernance: {} as Record<string, unknown>,
  },
}));

vi.mock("../api/companies", () => ({ companiesApi: mockCompaniesApi }));
vi.mock("../api/assets", () => ({ assetsApi: mockAssetsApi }));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mockSetBreadcrumbs }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [selectedCompany.current],
    selectedCompany: selectedCompany.current,
    selectedCompanyId: selectedCompany.current.id,
    setSelectedCompanyId: mockSetSelectedCompanyId,
  }),
}));

vi.mock("../components/InteractionGovernancePanel", () => ({
  InteractionGovernancePanel: () => null,
  applyGovernanceChange: (governance: unknown) => governance,
}));

vi.mock("./InstanceGeneralSettings", () => ({
  InstanceGeneralSettings: () => null,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("CompanySettings: accepting finished tasks", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    selectedCompany.current.interactionResolverGovernance = {};
    mockCompaniesApi.update.mockResolvedValue({
      ...selectedCompany.current,
      interactionResolverGovernance: { autoAcceptWhenJudgePasses: true },
    });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  function render() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.health, { status: "ok" as const, cloud: null });
    const root = createRoot(container);
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CompanySettings />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    return root;
  }

  function toggle() {
    return container.querySelector<HTMLElement>('[data-testid="company-settings-auto-accept-toggle"]');
  }

  it("is off for a company that never opened the setting", () => {
    const root = render();
    expect(toggle()?.getAttribute("aria-checked")).toBe("false");
    flushSync(() => root.unmount());
  });

  it("is on once the person turned it on", () => {
    selectedCompany.current.interactionResolverGovernance = { autoAcceptWhenJudgePasses: true };
    const root = render();
    expect(toggle()?.getAttribute("aria-checked")).toBe("true");
    flushSync(() => root.unmount());
  });

  it("saves the switch without dropping the other settings", async () => {
    selectedCompany.current.interactionResolverGovernance = {
      suggest_tasks: { cap: "board_only" },
    };
    const root = render();
    flushSync(() => toggle()?.click());
    // react-query runs the mutation function off the click, one tick later.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCompaniesApi.update).toHaveBeenCalledWith("company-1", {
      interactionResolverGovernance: {
        suggest_tasks: { cap: "board_only" },
        autoAcceptWhenJudgePasses: true,
      },
    });
    flushSync(() => root.unmount());
  });
});
