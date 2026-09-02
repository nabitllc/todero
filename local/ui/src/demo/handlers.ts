/*
  MSW handlers for the demo.

  Two layers:
  1. Store-aware handlers for what a visitor can change — create and move a
     task, comment and @ an agent, approve or reject, hire an agent.
  2. Replay for everything else: a recorded product response keyed by
     "METHOD /path". A path the recording never saw is a demo bug and answers
     599 loudly — never a silent 200.
*/
import { http, HttpResponse, delay } from "msw";
import { store, demoId, now } from "./store";
import { emitLiveEvent } from "./socket";
import { agentReply } from "./transcript";

const API = "/api";
const LATENCY_MS = [80, 200] as const;

type Json = Record<string, unknown>;

async function latency() {
  await delay(LATENCY_MS[0] + Math.random() * (LATENCY_MS[1] - LATENCY_MS[0]));
}

function key(method: string, url: string): string {
  const u = new URL(url);
  return `${method} ${u.pathname.replace(/^\/api/, "")}${u.search}`;
}

function keyWithoutSearch(method: string, url: string): string {
  const u = new URL(url);
  return `${method} ${u.pathname.replace(/^\/api/, "")}`;
}

/** Endpoints the recording never saw because the seeded company never had the state. */
const defaults: Array<[RegExp, unknown]> = [
  [/\/issues\/[^/]+\/active-run$/, null],
  [/\/documents\/[^/]+\/annotations$/, []],
  [/\/issues\/[^/]+\/interactions$/, []],
];

/** The UI addresses a task by id or by identifier; the recording may hold either. */
function twin(path: string): string | null {
  const m = /^\/issues\/([^/?]+)/.exec(path);
  if (!m) return null;
  const issue = findIssue(m[1]);
  if (!issue) return null;
  const other = m[1] === issue.id ? issue.identifier : issue.id;
  return other ? path.replace(m[1], String(other)) : null;
}

function replay(method: string, url: string) {
  const exact = key(method, url);
  if (store.has(exact)) return store.read(exact);
  const bare = keyWithoutSearch(method, url);
  if (store.has(bare)) return store.read(bare);
  const path = bare.slice(method.length + 1);
  const alt = twin(path);
  if (alt) {
    const altKey = `${method} ${alt}`;
    if (store.has(altKey)) return store.read(altKey);
  }
  for (const [pattern, value] of defaults) if (pattern.test(path)) return value;
  return perIssueFallback(method, path);
}

/** Sub-resources of a task the recording never saw (a task the visitor created). */
const EMPTY_SUBRESOURCES = new Set([
  "comments", "activity", "attachments", "work-products", "live-runs", "runs", "feedback-votes",
  "documents", "accepted-plan-decompositions", "tree-holds", "interactions",
]);

function perIssueFallback(method: string, path: string): unknown {
  const m = /^\/issues\/([^/]+)\/(.+)$/.exec(path);
  if (!m || method !== "GET") return undefined;
  const rest = m[2];
  const head = rest.split("/")[0];
  if (EMPTY_SUBRESOURCES.has(head) && rest === head) return [];
  if (rest === "documents/plan") return { __status: 404, body: { error: "Document not found" } };
  // Anything else: borrow the shape from the quietest seeded task.
  const template = listIssues().find((i) => i.status === "backlog") ?? listIssues()[0];
  if (!template) return undefined;
  for (const ref of [template.id, template.identifier]) {
    const k = `GET /issues/${ref}/${rest}`;
    if (store.has(k)) return store.read(k);
  }
  return undefined;
}

function unhandled(method: string, url: string) {
  const what = `demo: unhandled ${method} ${new URL(url).pathname}`;
  console.error(what);
  return HttpResponse.json({ error: what }, { status: 599 });
}

// --- collections the mutations touch -------------------------------------

const companyId = () => store.companyId;
const issuesKey = () => `GET /companies/${companyId()}/issues`;
const issueKey = (id: string) => `GET /issues/${id}`;
const commentsKey = (id: string) => `GET /issues/${id}/comments`;
const activityKey = (id: string) => `GET /issues/${id}/activity`;
const approvalsKey = () => `GET /companies/${companyId()}/approvals`;
const agentsKey = () => `GET /companies/${companyId()}/agents`;
const dashboardKey = () => `GET /companies/${companyId()}/dashboard`;

function listIssues(): Json[] {
  const v = store.read<unknown>(issuesKey());
  if (Array.isArray(v)) return v as Json[];
  const wrapped = v as { issues?: Json[] } | undefined;
  return wrapped?.issues ?? [];
}

function writeIssues(next: Json[]) {
  const v = store.read<unknown>(issuesKey());
  if (Array.isArray(v)) store.writeMatching(issuesKey(), next);
  else store.writeMatching(issuesKey(), { ...(v as Json), issues: next });
}

function findIssue(idOrIdentifier: string): Json | undefined {
  return listIssues().find((i) => i.id === idOrIdentifier || i.identifier === idOrIdentifier);
}

function putIssue(issue: Json) {
  const next = listIssues().map((i) => (i.id === issue.id ? issue : i));
  if (!next.some((i) => i.id === issue.id)) next.unshift(issue);
  writeIssues(next);
  store.writeMatching(issueKey(String(issue.id)), issue);
  if (issue.identifier) store.writeMatching(issueKey(String(issue.identifier)), issue);
  activity("issue", String(issue.id), "issue.updated", { issueId: issue.id });
}

/** The product's live event for "something happened": the provider invalidates from it. */
function activity(entityType: string, entityId: string, action: string, details: Json = {}) {
  emitLiveEvent({
    type: "activity.logged",
    companyId: companyId(),
    createdAt: now(),
    payload: {
      id: demoId("activity"),
      companyId: companyId(),
      entityType,
      entityId,
      action,
      actorType: "user",
      actorId: store.userId,
      details,
      createdAt: now(),
    },
  });
}

function listApprovals(): Json[] {
  const v = store.read<unknown>(approvalsKey());
  if (Array.isArray(v)) return v as Json[];
  return ((v as { approvals?: Json[] } | undefined)?.approvals ?? []) as Json[];
}

function writeApprovals(next: Json[]) {
  const v = store.read<unknown>(approvalsKey());
  if (Array.isArray(v)) store.writeMatching(approvalsKey(), next);
  else store.writeMatching(approvalsKey(), { ...(v as Json), approvals: next });
}

function bumpDashboard(fn: (d: Json) => void) {
  const d = store.read<Json>(dashboardKey());
  if (!d) return;
  const next = structuredClone(d);
  fn(next);
  store.write(dashboardKey(), next);
}

// --- store-aware routes ---------------------------------------------------

const mutations = [
  // Create a task
  http.post(`${API}/companies/:companyId/issues`, async ({ request }) => {
    await latency();
    const body = (await request.json()) as Json;
    const template = listIssues()[0] ?? {};
    const number = listIssues().length + 1;
    const issue: Json = {
      ...template,
      ...body,
      id: demoId("issue"),
      issueNumber: number,
      identifier: `${store.companyPrefix}-${number}`,
      status: body.status ?? "todo",
      priority: body.priority ?? "medium",
      assigneeAgentId: body.assigneeAgentId ?? null,
      assigneeUserId: null,
      createdByUserId: store.userId,
      createdByAgentId: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      labels: [],
      labelIds: [],
      createdAt: now(),
      updatedAt: now(),
    };
    putIssue(issue);
    bumpDashboard((d) => {
      const tasks = d.tasks as Json;
      tasks.open = Number(tasks.open) + 1;
    });
    return HttpResponse.json(issue, { status: 201 });
  }),

  // Move a task, change assignee, edit
  http.patch(`${API}/issues/:id`, async ({ request, params }) => {
    await latency();
    const body = (await request.json()) as Json;
    const current = findIssue(String(params.id));
    if (!current) return unhandled("PATCH", request.url);
    const next: Json = { ...current, ...body, updatedAt: now() };
    if (body.status === "in_progress" && !current.startedAt) next.startedAt = now();
    if (body.status === "done") next.completedAt = now();
    putIssue(next);
    return HttpResponse.json({ issue: next, ...next });
  }),

  // Read receipt fires on every task open
  http.post(`${API}/issues/:id/read`, async ({ params }) => {
    await latency();
    return HttpResponse.json({ id: params.id, lastReadAt: now() });
  }),

  // Comment; an @-mentioned agent answers from the canned transcript
  http.post(`${API}/issues/:id/comments`, async ({ request, params }) => {
    await latency();
    const body = (await request.json()) as Json;
    const issue = findIssue(String(params.id));
    const issueId = String(issue?.id ?? params.id);
    const comment: Json = {
      id: demoId("comment"),
      companyId: companyId(),
      issueId,
      authorType: "user",
      authorAgentId: null,
      authorUserId: store.userId,
      body: String(body.body ?? ""),
      presentation: null,
      metadata: null,
      createdAt: now(),
      updatedAt: now(),
    };
    const k = commentsKey(issueId);
    const appendComment = (c: Json) => {
      const list = [...((store.read<Json[]>(k) ?? []) as Json[]), c];
      store.writeMatching(k, list);
      if (issue?.identifier) store.writeMatching(commentsKey(String(issue.identifier)), list);
    };
    appendComment(comment);
    activity("issue", issueId, "issue.comment_added", { issueId, commentId: comment.id });

    const mention = /@([A-Za-z][\w-]*)/.exec(comment.body as string)?.[1];
    if (mention) {
      const agents = (store.read<Json[]>(agentsKey()) ?? []) as Json[];
      const agent = agents.find((a) => String(a.name).toLowerCase().startsWith(mention.toLowerCase()));
      if (agent) {
        window.setTimeout(() => {
          const reply: Json = {
            ...comment,
            id: demoId("comment"),
            authorType: "agent",
            authorAgentId: agent.id,
            authorUserId: null,
            body: agentReply(String(agent.name), comment.body as string),
            createdAt: now(),
            updatedAt: now(),
          };
          appendComment(reply);
          activity("issue", issueId, "issue.comment_added", { issueId, commentId: reply.id, agentId: agent.id });
        }, 1500 + Math.random() * 1500);
      }
    }
    return HttpResponse.json(comment, { status: 201 });
  }),

  // Approve / reject
  http.post(`${API}/approvals/:id/:decision`, async ({ params, request }) => {
    const decision = String(params.decision);
    if (decision !== "approve" && decision !== "reject") return unhandled("POST", request.url);
    await latency();
    const body = ((await request.json().catch(() => ({}))) ?? {}) as Json;
    const approvals = listApprovals();
    const current = approvals.find((a) => a.id === params.id);
    if (!current) return unhandled("POST", request.url);
    const next: Json = {
      ...current,
      status: decision === "approve" ? "approved" : "rejected",
      decisionNote: (body.note as string) ?? (body.decisionNote as string) ?? null,
      decidedByUserId: store.userId,
      decidedAt: now(),
      updatedAt: now(),
    };
    writeApprovals(approvals.map((a) => (a.id === next.id ? next : a)));
    bumpDashboard((d) => {
      d.pendingApprovals = Math.max(0, Number(d.pendingApprovals) - 1);
      (d.budgets as Json).pendingApprovals = d.pendingApprovals;
    });
    if (decision === "approve" && current.type === "hire_agent") {
      hireFromApproval(current);
    }
    activity("approval", String(next.id), decision === "approve" ? "approval.approved" : "approval.rejected", { approvalId: next.id });
    return HttpResponse.json(next);
  }),

  // A single comment, fetched after a live "comment added" event
  http.get(`${API}/issues/:id/comments/:commentId`, async ({ params, request }) => {
    const issue = findIssue(String(params.id));
    const list = (store.read<Json[]>(commentsKey(String(issue?.id ?? params.id))) ?? []) as Json[];
    const hit = list.find((c) => c.id === params.commentId);
    if (!hit) return unhandled("GET", request.url);
    await latency();
    return HttpResponse.json(hit);
  }),

  // Approval detail after a decision
  http.get(`${API}/approvals/:id`, async ({ params, request }) => {
    const hit = listApprovals().find((a) => a.id === params.id);
    if (!hit) return unhandled("GET", request.url);
    await latency();
    return HttpResponse.json(hit);
  }),
  http.get(`${API}/approvals/:id/comments`, async () => {
    await latency();
    return HttpResponse.json([]);
  }),
  http.get(`${API}/approvals/:id/issues`, async () => {
    await latency();
    return HttpResponse.json([]);
  }),

  // Hire an agent directly
  http.post(`${API}/companies/:companyId/agents`, async ({ request }) => {
    await latency();
    const body = (await request.json()) as Json;
    const agent = createAgent(body);
    return HttpResponse.json(agent, { status: 201 });
  }),
];

function createAgent(body: Json): Json {
  const agents = (store.read<Json[]>(agentsKey()) ?? []) as Json[];
  const template = agents[0] ?? {};
  const name = String(body.name ?? "New agent");
  const agent: Json = {
    ...template,
    ...body,
    id: demoId("agent"),
    companyId: companyId(),
    name,
    urlKey: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    status: "idle",
    role: body.role ?? "general",
    title: body.title ?? null,
    reportsTo: body.reportsTo ?? null,
    adapterType: body.adapterType ?? "process",
    adapterConfig: body.adapterConfig ?? {},
    runtimeConfig: body.runtimeConfig ?? {},
    budgetMonthlyCents: body.budgetMonthlyCents ?? 0,
    spentMonthlyCents: 0,
    lastHeartbeatAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  store.writeMatching(agentsKey(), [...agents, agent]);
  bumpDashboard((d) => {
    (d.agents as Json).active = Number((d.agents as Json).active) + 1;
  });
  activity("agent", String(agent.id), "agent.created", { agentId: agent.id });
  return agent;
}

function hireFromApproval(approval: Json) {
  const spec = (approval.payload ?? {}) as Json;
  createAgent({
    name: spec.name ?? "Support",
    role: spec.role ?? "general",
    title: spec.title ?? "Support",
    adapterType: spec.adapterType ?? "process",
    capabilities: spec.capabilities ?? null,
  });
}

// --- replay + the alarm ---------------------------------------------------

const replayAll = http.all(`${API}/*`, async ({ request }) => {
  const method = request.method.toUpperCase();
  const hit = replay(method, request.url);
  if (hit === undefined) {
    if (method === "GET") return unhandled(method, request.url);
    // Automatic and incidental writes the recording saw answer as recorded;
    // anything else is a demo gap.
    return unhandled(method, request.url);
  }
  await latency();
  const recorded = hit as { __status?: number; body?: unknown } | null;
  if (recorded && typeof recorded === "object" && typeof recorded.__status === "number") {
    return HttpResponse.json(recorded.body ?? null, { status: recorded.__status });
  }
  return HttpResponse.json(hit);
});

export const handlers = [...mutations, replayAll];
