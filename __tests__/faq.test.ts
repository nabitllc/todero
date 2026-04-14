import { FAQ_DATA, lookupFAQ } from "@/lib/faq"

describe("FAQ_DATA", () => {
  it("contains at least 10 entries", () => {
    expect(FAQ_DATA.length).toBeGreaterThanOrEqual(10)
  })

  it("every entry has required fields", () => {
    for (const entry of FAQ_DATA) {
      expect(entry.id).toBeTruthy()
      expect(entry.question).toBeTruthy()
      expect(entry.answer).toBeTruthy()
      expect(Array.isArray(entry.keywords)).toBe(true)
      expect(entry.keywords.length).toBeGreaterThan(0)
    }
  })

  it("covers required topics", () => {
    const ids = FAQ_DATA.map((e) => e.id)
    expect(ids).toContain("account-setup")
    expect(ids).toContain("navigation")
    expect(ids).toContain("known-limitations")
    expect(ids).toContain("report-bug")
    expect(ids).toContain("sprint-workflow")
    expect(ids).toContain("agent-roles")
    expect(ids).toContain("issue-types")
    expect(ids).toContain("status-meanings")
    expect(ids).toContain("escalate")
  })
})

describe("lookupFAQ", () => {
  it("returns null for empty query", () => {
    expect(lookupFAQ("")).toBeNull()
    expect(lookupFAQ("  ")).toBeNull()
  })

  it("matches 'setup' to account setup entry", () => {
    const result = lookupFAQ("setup")
    expect(result).not.toBeNull()
    expect(result).toContain("kaos.nabit.work")
  })

  it("matches 'how do I report a bug' (case-insensitive)", () => {
    const result = lookupFAQ("HOW DO I REPORT A BUG")
    expect(result).not.toBeNull()
    expect(result).toContain("MC API")
  })

  it("matches 'sprint workflow' query", () => {
    const result = lookupFAQ("sprint workflow")
    expect(result).not.toBeNull()
    expect(result).toContain("7am")
  })

  it("matches 'agent roles' query", () => {
    const result = lookupFAQ("agent roles")
    expect(result).not.toBeNull()
    expect(result).toContain("builder")
  })

  it("matches 'status meanings' query", () => {
    const result = lookupFAQ("what does status mean")
    expect(result).not.toBeNull()
    expect(result).toContain("backlog")
  })

  it("matches partial keyword 'escalat'", () => {
    const result = lookupFAQ("escalat")
    expect(result).not.toBeNull()
    expect(result).toContain("PATCH")
  })

  it("matches 'api' to MC API entry", () => {
    const result = lookupFAQ("api")
    expect(result).not.toBeNull()
    expect(result).toContain("/api/issues")
  })

  it("returns null for completely unrelated query", () => {
    const result = lookupFAQ("xyzzy")
    expect(result).toBeNull()
  })
})
