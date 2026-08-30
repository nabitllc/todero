// @vitest-environment jsdom

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOnboardingPath } from "./lib/onboarding-route";
import { SELECTED_COMPANY_STORAGE_KEY } from "./lib/company-selection";

vi.hoisted(() => {
  const sheetProto = window.CSSStyleSheet.prototype as unknown as {
    insertRule: (rule: string, index?: number) => number;
    __papColdOpenPatched?: boolean;
  };
  if (!sheetProto.__papColdOpenPatched) {
    const original = sheetProto.insertRule;
    sheetProto.insertRule = function patched(this: CSSStyleSheet, rule: string, index?: number) {
      try {
        return original.call(this, rule, index);
      } catch {
        try {
          return original.call(this, ".pap-cold-open-noop{}", index);
        } catch {
          return this.cssRules?.length ?? 0;
        }
      }
    };
    sheetProto.__papColdOpenPatched = true;
  }
});

type ColdOpenCompany = {
  id: string;
  name: string;
  issuePrefix: string;
  status: string;
  createdAt: Date;
};

const archived: ColdOpenCompany = {
  id: "archived",
  name: "Old Co",
  issuePrefix: "ARC",
  status: "archived",
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
};
const firstCreated: ColdOpenCompany = {
  id: "first",
  name: "First Co",
  issuePrefix: "ONE",
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};
const lastViewed: ColdOpenCompany = {
  id: "last",
  name: "Later Co",
  issuePrefix: "TWO",
  status: "active",
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
};

const companyState = vi.hoisted(() => ({
  companies: [] as ColdOpenCompany[],
  selectedCompanyId: null as string | null,
  selectedCompany: null as ColdOpenCompany | null,
  loading: false,
}));

vi.mock("./context/CompanyContext", () => ({
  useCompany: () => ({
    companies: companyState.companies,
    selectedCompanyId: companyState.selectedCompanyId,
    selectedCompany: companyState.selectedCompany,
    loading: companyState.loading,
  }),
  CompanyProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { CompanyRootRedirect } = await import("./App");

function LocationProbe() {
  const location = useLocation();
  return <div>{`LOC@${location.pathname}`}</div>;
}

function DashboardProbe() {
  const location = useLocation();
  return <div>{`DASHBOARD@${location.pathname}`}</div>;
}

function renderColdOpen(container: HTMLElement) {
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <LocationProbe />
        <Routes>
          <Route index element={<CompanyRootRedirect />} />
          <Route path="onboarding" element={<div>ONBOARDING_WIZARD</div>} />
          <Route path=":companyPrefix/dashboard" element={<DashboardProbe />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return root;
}

describe("CompanyRootRedirect cold open", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    localStorage.clear();
    companyState.companies = [];
    companyState.selectedCompanyId = null;
    companyState.selectedCompany = null;
    companyState.loading = false;
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("opens the onboarding wizard when there are zero active orgs", async () => {
    const root = renderColdOpen(container);
    await vi.waitFor(() => expect(container.textContent).toContain("ONBOARDING_WIZARD"));
    expect(container.textContent).toContain("LOC@/onboarding");
    expect(isOnboardingPath("/onboarding")).toBe(true);
    expect(container.textContent).not.toContain("Create your first organization");
    expect(container.textContent).not.toContain("LOC@/ARC/");
    flushSync(() => root.unmount());
  });

  it("opens the onboarding wizard when the only orgs are archived", async () => {
    companyState.companies = [archived];
    companyState.selectedCompanyId = archived.id;
    companyState.selectedCompany = archived;
    localStorage.setItem(SELECTED_COMPANY_STORAGE_KEY, archived.id);

    const root = renderColdOpen(container);
    await vi.waitFor(() => expect(container.textContent).toContain("ONBOARDING_WIZARD"));
    expect(container.textContent).toContain("LOC@/onboarding");
    expect(container.textContent).not.toContain("Create your first organization");
    expect(container.textContent).not.toContain("LOC@/ARC/");
    flushSync(() => root.unmount());
  });

  it("opens the last-viewed org when that id is stored and still active", async () => {
    companyState.companies = [archived, lastViewed, firstCreated];
    companyState.selectedCompanyId = null;
    companyState.selectedCompany = null;
    localStorage.setItem(SELECTED_COMPANY_STORAGE_KEY, lastViewed.id);

    const root = renderColdOpen(container);
    await vi.waitFor(() => expect(container.textContent).toContain("LOC@/TWO/dashboard"));
    expect(container.textContent).not.toContain("LOC@/ONE/dashboard");
    expect(container.textContent).not.toContain("LOC@/ARC/");
    flushSync(() => root.unmount());
  });

  it("opens the first-created active org when last-viewed is missing", async () => {
    companyState.companies = [lastViewed, firstCreated, archived];
    companyState.selectedCompanyId = null;
    companyState.selectedCompany = null;

    const root = renderColdOpen(container);
    await vi.waitFor(() => expect(container.textContent).toContain("LOC@/ONE/dashboard"));
    expect(container.textContent).not.toContain("LOC@/TWO/dashboard");
    expect(container.textContent).not.toContain("LOC@/ARC/");
    flushSync(() => root.unmount());
  });

  it("opens the first-created active org when last-viewed is archived", async () => {
    companyState.companies = [archived, lastViewed, firstCreated];
    companyState.selectedCompanyId = archived.id;
    companyState.selectedCompany = archived;
    localStorage.setItem(SELECTED_COMPANY_STORAGE_KEY, archived.id);

    const root = renderColdOpen(container);
    await vi.waitFor(() => expect(container.textContent).toContain("LOC@/ONE/dashboard"));
    expect(container.textContent).not.toContain("LOC@/ARC/");
    flushSync(() => root.unmount());
  });
});
