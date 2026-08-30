import { describe, expect, it } from "vitest";
import {
  activeCompanies,
  isActiveCompany,
  pickColdOpenCompany,
  resolveArchivedCompanyBounce,
  resolveColdOpenPath,
  shouldSyncCompanySelectionFromRoute,
} from "./company-selection";

describe("shouldSyncCompanySelectionFromRoute", () => {
  it("does not resync when selection already matches the route", () => {
    expect(
      shouldSyncCompanySelectionFromRoute({
        selectionSource: "route_sync",
        selectedCompanyId: "pap",
        routeCompanyId: "pap",
      }),
    ).toBe(false);
  });

  it("defers route sync while a manual company switch is in flight", () => {
    expect(
      shouldSyncCompanySelectionFromRoute({
        selectionSource: "manual",
        selectedCompanyId: "pap",
        routeCompanyId: "ret",
      }),
    ).toBe(false);
  });

  it("syncs back to the route company for non-manual mismatches", () => {
    expect(
      shouldSyncCompanySelectionFromRoute({
        selectionSource: "route_sync",
        selectedCompanyId: "pap",
        routeCompanyId: "ret",
      }),
    ).toBe(true);
  });
});

describe("resolveArchivedCompanyBounce", () => {
  const archived = { id: "old", name: "Old Co", issuePrefix: "OLD", status: "archived" };
  const active = { id: "pap", name: "Todero", issuePrefix: "PAP", status: "active" };
  const other = { id: "ret", name: "Retail", issuePrefix: "RET", status: "active" };

  it("bounces a cold arrival on an archived company's URL to the active selection", () => {
    expect(
      resolveArchivedCompanyBounce({
        matchedCompany: archived,
        selectedCompanyId: "pap",
        companies: [archived, active, other],
      }),
    ).toEqual(active);
  });

  it("bounces to the first active company when nothing is selected", () => {
    expect(
      resolveArchivedCompanyBounce({
        matchedCompany: archived,
        selectedCompanyId: null,
        companies: [archived, other],
      }),
    ).toEqual(other);
  });

  it("does not bounce a deliberate visit where the archived company is already selected", () => {
    expect(
      resolveArchivedCompanyBounce({
        matchedCompany: archived,
        selectedCompanyId: "old",
        companies: [archived, active],
      }),
    ).toBeNull();
  });

  it("does not bounce active companies or when every company is archived", () => {
    expect(
      resolveArchivedCompanyBounce({
        matchedCompany: active,
        selectedCompanyId: null,
        companies: [archived, active],
      }),
    ).toBeNull();
    expect(
      resolveArchivedCompanyBounce({
        matchedCompany: archived,
        selectedCompanyId: null,
        companies: [archived],
      }),
    ).toBeNull();
  });
});


describe("active companies", () => {
  it("treats anything but archived as active", () => {
    expect(isActiveCompany({ status: "active" })).toBe(true);
    expect(isActiveCompany({ status: "paused" })).toBe(true);
    expect(isActiveCompany({ status: "archived" })).toBe(false);
  });

  it("drops archived orgs from the active list", () => {
    const archived = { id: "old", status: "archived" };
    const active = { id: "pap", status: "active" };
    const paused = { id: "pau", status: "paused" };
    expect(activeCompanies([archived, active, paused])).toEqual([active, paused]);
  });
});

describe("pickColdOpenCompany", () => {
  const archived = {
    id: "archived",
    issuePrefix: "ARC",
    status: "archived",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
  };
  const firstCreated = {
    id: "first",
    issuePrefix: "ONE",
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const lastViewed = {
    id: "last",
    issuePrefix: "TWO",
    status: "active",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
  };

  it("returns null when there are no companies", () => {
    expect(pickColdOpenCompany([], null)).toBeNull();
    expect(resolveColdOpenPath({ companies: [], lastViewedId: null })).toBe("/onboarding");
  });

  it("returns null for archived-only lists, which count as zero active", () => {
    expect(pickColdOpenCompany([archived], "archived")).toBeNull();
    expect(resolveColdOpenPath({ companies: [archived], lastViewedId: "archived" })).toBe(
      "/onboarding",
    );
  });

  it("opens the last-viewed org when that id is still active", () => {
    // Array order is newest-first so array[0] is NOT the last-viewed org.
    expect(
      pickColdOpenCompany([lastViewed, firstCreated, archived], "last"),
    ).toEqual(lastViewed);
    expect(
      resolveColdOpenPath({
        companies: [lastViewed, firstCreated, archived],
        lastViewedId: "last",
      }),
    ).toBe("/TWO/dashboard");
  });

  it("opens the first-created active org when last-viewed is missing", () => {
    expect(pickColdOpenCompany([lastViewed, firstCreated, archived], null)).toEqual(
      firstCreated,
    );
    expect(
      resolveColdOpenPath({
        companies: [lastViewed, firstCreated, archived],
        lastViewedId: null,
      }),
    ).toBe("/ONE/dashboard");
  });

  it("opens the first-created active org when last-viewed is archived", () => {
    expect(
      pickColdOpenCompany([archived, lastViewed, firstCreated], "archived"),
    ).toEqual(firstCreated);
  });

  it("never lands on an archived org on cold open", () => {
    const picks = [
      pickColdOpenCompany([archived], null),
      pickColdOpenCompany([archived, firstCreated], "archived"),
      pickColdOpenCompany([archived, lastViewed, firstCreated], null),
    ];
    for (const pick of picks) {
      expect(pick === null || pick.status !== "archived").toBe(true);
    }
    expect(resolveColdOpenPath({ companies: [archived], lastViewedId: null })).toBe(
      "/onboarding",
    );
    expect(
      resolveColdOpenPath({
        companies: [archived, firstCreated],
        lastViewedId: "archived",
      }),
    ).not.toContain("ARC");
  });

  it("does not use array[0] when that is not created order", () => {
    expect(pickColdOpenCompany([lastViewed, firstCreated], undefined)?.id).toBe("first");
  });
});
