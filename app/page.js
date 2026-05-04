// LAYOUT STRUCTURE — DO NOT BREAK:
// <div min-h-screen flex>
//   <BusinessRail />          ← w-14, always visible
//   <aside hidden lg:flex>    ← sidebar, desktop only
//   <main flex-1>             ← content
//   <MobileNav lg:hidden>     ← mobile bottom nav, hidden on desktop
// </div>
'use client';
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Home;
var react_1 = require("react");
var lucide_react_1 = require("lucide-react");
var mc_constants_1 = require("@/lib/mc-constants");
var BusinessRail_1 = require("@/components/BusinessRail");
var OnboardingWizard_1 = require("@/components/OnboardingWizard");
var OverviewTab_1 = require("@/components/tabs/OverviewTab");
var ActivityTab_1 = require("@/components/tabs/ActivityTab");
var CrewTab_1 = require("@/components/tabs/CrewTab");
var CalendarTab_1 = require("@/components/tabs/CalendarTab");
var OfficeTab_1 = require("@/components/tabs/OfficeTab");
var MemoryTab_1 = require("@/components/tabs/MemoryTab");
var BoardTab_1 = require("@/components/tabs/BoardTab");
var FeaturesTab_1 = require("@/components/tabs/FeaturesTab");
var PipelineTab_1 = require("@/components/tabs/PipelineTab");
var IssuesTab_1 = require("@/components/tabs/IssuesTab");
var AutomationsTab_1 = require("@/components/tabs/AutomationsTab");
var ChatTab_1 = require("@/components/tabs/ChatTab");
var InfraTab_1 = require("@/components/tabs/InfraTab");
var SettingsTab_1 = require("@/components/tabs/SettingsTab");
var ProductBoardTab_1 = require("@/components/tabs/ProductBoardTab");
var ProjectsTab_1 = require("@/components/tabs/ProjectsTab");
var InboxTab_1 = require("@/components/tabs/InboxTab");
var AIServicesTab_1 = require("@/components/tabs/AIServicesTab");
var EpicMapTab_1 = require("@/components/tabs/EpicMapTab");
var QuickActionFab_1 = require("@/components/QuickActionFab");
var SidebarNav_1 = require("@/components/SidebarNav");
var SearchOverlay_1 = require("@/components/SearchOverlay");
var TopBar_1 = require("@/components/TopBar");
var HubSwitcher_1 = require("@/components/HubSwitcher");
var InboxDrawer_1 = require("@/components/InboxDrawer");
var LUCIDE_ICONS = {
    overview: lucide_react_1.LayoutDashboard, activity: lucide_react_1.Activity, team: lucide_react_1.Users, calendar: lucide_react_1.CalendarDays,
    office: lucide_react_1.Building2, memory: lucide_react_1.Brain, board: lucide_react_1.Kanban, features: lucide_react_1.Map, issues: lucide_react_1.List, automations: lucide_react_1.Zap, chat: lucide_react_1.MessageSquare, infra: lucide_react_1.Server, settings: lucide_react_1.Settings,
};
var NAV = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'activity', label: 'Activity', icon: '📡' },
    { id: 'team', label: 'Team', icon: '👥' },
    { id: 'calendar', label: 'Calendar', icon: '📅' },
    { id: 'office', label: 'Office', icon: '🏢' },
    { id: 'memory', label: 'Memory', icon: '🧠' },
    { id: 'board', label: 'Board', icon: '📋' },
    { id: 'features', label: 'Features', icon: '🗺️' },
    { id: 'epic-map', label: 'Epic Map', icon: '🗂️' },
    { id: 'pipeline', label: 'Pipeline', icon: '🏭' },
    { id: 'issues', label: 'Issues', icon: '📝' },
    { id: 'projects', label: 'Projects', icon: '📦' },
    { id: 'product-board', label: 'Product Board', icon: '🗓️' },
    { id: 'divider', label: '', icon: '' },
    { id: 'automations', label: 'Automations', icon: '⚡' },
    { id: 'chat', label: 'Chat', icon: '💬' },
    { id: 'infra', label: 'Infra', icon: '⚙️' },
    { id: 'ai-services', label: 'AI Services', icon: '🤖' },
    { id: 'inbox', label: 'Inbox', icon: '📬' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
];
var VALID_TABS = ['overview', 'activity', 'team', 'calendar', 'office', 'memory', 'board', 'features', 'epic-map', 'pipeline', 'issues', 'projects', 'product-board', 'automations', 'chat', 'infra', 'settings', 'ai-services', 'inbox'];
var BIZ_EMOJI = {
    'Vespera': '🖤', 'Kemuni': '🚀', 'Mission Control': '🧠', 'Todero': '🧠',
    'Infrastructure': '⚙️', 'KAOS': '🤖',
};
function bizToSlug(name) {
    return name.toLowerCase().replace(/\s+/g, '-');
}
function slugToBizName(slug) {
    var special = { 'kaos': 'KAOS' };
    if (special[slug])
        return special[slug];
    return slug.split('-').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
}
function parseURL() {
    if (typeof window === 'undefined')
        return { tab: 'overview', business: null };
    var parts = window.location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'b' && parts[1]) {
        var biz = slugToBizName(parts[1]);
        var tab = parts[2] && VALID_TABS.includes(parts[2]) ? parts[2] : 'overview';
        return { tab: tab, business: biz };
    }
    if (parts[0] && VALID_TABS.includes(parts[0])) {
        return { tab: parts[0], business: null };
    }
    return { tab: 'overview', business: null };
}
function buildPath(business, tab) {
    if (business) {
        var slug = bizToSlug(business);
        return tab === 'overview' ? "/b/".concat(slug) : "/b/".concat(slug, "/").concat(tab);
    }
    return tab === 'overview' ? '/' : "/".concat(tab);
}
function Home() {
    var _this = this;
    var _a;
    // MC-hydration: start with SSR-safe default; apply URL/localStorage after mount to avoid hydration mismatch
    var _b = (0, react_1.useState)('overview'), tab = _b[0], setTab = _b[1];
    var _c = (0, react_1.useState)(null), userRole = _c[0], setUserRole = _c[1];
    var _d = (0, react_1.useState)(null), currentIdentity = _d[0], setCurrentIdentity = _d[1];
    var _e = (0, react_1.useState)(''), clock = _e[0], setClock = _e[1];
    var _f = (0, react_1.useState)([]), memFiles = _f[0], setMemFiles = _f[1];
    var _g = (0, react_1.useState)(null), openMem = _g[0], setOpenMem = _g[1];
    var _h = (0, react_1.useState)(0), feedIdx = _h[0], setFeedIdx = _h[1];
    var _j = (0, react_1.useState)(0), tick = _j[0], setTick = _j[1];
    var _k = (0, react_1.useState)(false), showMobileMore = _k[0], setShowMobileMore = _k[1];
    var _l = (0, react_1.useState)(false), searchOpen = _l[0], setSearchOpen = _l[1];
    var _m = (0, react_1.useState)(false), inboxOpen = _m[0], setInboxOpen = _m[1];
    var _o = (0, react_1.useState)(0), inboxPendingCount = _o[0], setInboxPendingCount = _o[1];
    var _p = (0, react_1.useState)(null), liveStatus = _p[0], setLiveStatus = _p[1];
    var _q = (0, react_1.useState)(0), statusAt = _q[0], setStatusAt = _q[1];
    var _r = (0, react_1.useState)(0), agoSec = _r[0], setAgoSec = _r[1];
    var _s = (0, react_1.useState)(null), liveAgents = _s[0], setLiveAgents = _s[1];
    var _t = (0, react_1.useState)(null), liveCrons = _t[0], setLiveCrons = _t[1];
    var _u = (0, react_1.useState)(null), projects = _u[0], setProjects = _u[1];
    var _v = (0, react_1.useState)([]), globalToasts = _v[0], setGlobalToasts = _v[1];
    var globalToastIdRef = react_1.default.useRef(0);
    var addGlobalToast = react_1.default.useCallback(function (text, color) {
        if (color === void 0) { color = mc_constants_1.TOAST_COLORS.default; }
        var id = ++globalToastIdRef.current;
        setGlobalToasts(function (t) { var next = __spreadArray(__spreadArray([], t, true), [{ id: id, text: text, color: color }], false); return next.length > 4 ? next.slice(-4) : next; });
        setTimeout(function () { return setGlobalToasts(function (t) { return t.filter(function (x) { return x.id !== id; }); }); }, 4000);
    }, []);
    var _w = (0, react_1.useState)(false), syncing = _w[0], setSyncing = _w[1];
    var globalSync = function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    setSyncing(true);
                    return [4 /*yield*/, Promise.all([
                            fetch('/api/status').then(function (r) { return r.json(); }).then(function (d) { setLiveStatus(d); setStatusAt(Date.now()); }).catch(function () { }),
                            fetch('/api/agents').then(function (r) { return r.json(); }).then(function (d) { if (Array.isArray(d))
                                setLiveAgents(d); }).catch(function () { }),
                            fetch('/api/automations').then(function (r) { return r.json(); }).then(function (d) { if (Array.isArray(d))
                                setLiveCrons(d); }).catch(function () { }),
                            fetch('/api/projects').then(function (r) { return r.json(); }).then(function (d) { if (Array.isArray(d) && d.length > 0)
                                setProjects(d); }).catch(function () { }),
                        ])];
                case 1:
                    _a.sent();
                    setStatusCountdown(30);
                    setSyncing(false);
                    return [2 /*return*/];
            }
        });
    }); };
    var _x = (0, react_1.useState)(null), agentModal = _x[0], setAgentModal = _x[1];
    var _y = (0, react_1.useState)(null), cronModal = _y[0], setCronModal = _y[1];
    var _z = (0, react_1.useState)(false), unreadChat = _z[0], setUnreadChat = _z[1];
    // MC-hydration: start null; apply from URL after mount
    var _0 = (0, react_1.useState)(null), selectedBusiness = _0[0], setSelectedBusiness = _0[1];
    var _1 = (0, react_1.useState)(false), showOnboarding = _1[0], setShowOnboarding = _1[1];
    var _2 = (0, react_1.useState)(0), businessRailRefresh = _2[0], setBusinessRailRefresh = _2[1];
    // MC-hydration: start undefined; apply from URL params after mount
    var _3 = (0, react_1.useState)(undefined), boardFeatureFilter = _3[0], setBoardFeatureFilter = _3[1];
    var _4 = (0, react_1.useState)(undefined), boardFeatureFilterName = _4[0], setBoardFeatureFilterName = _4[1];
    var _5 = (0, react_1.useState)([]), issueActivity = _5[0], setIssueActivity = _5[1];
    var _6 = (0, react_1.useState)('week'), calendarView = _6[0], setCalendarView = _6[1];
    var _7 = (0, react_1.useState)([]), calendarIssues = _7[0], setCalendarIssues = _7[1];
    var _8 = (0, react_1.useState)({}), agentRunsData = _8[0], setAgentRunsData = _8[1];
    var _9 = (0, react_1.useState)({}), agentIssueCounts = _9[0], setAgentIssueCounts = _9[1];
    // Read mc-role cookie (not httpOnly — accessible to JS) for RBAC-aware UI
    (0, react_1.useEffect)(function () {
        var match = document.cookie.match(/(?:^|;\s*)mc-role=([^;]+)/);
        if (match) {
            var raw = decodeURIComponent(match[1]);
            var colonIdx = raw.indexOf(':');
            if (colonIdx !== -1) {
                setCurrentIdentity(raw.slice(0, colonIdx));
                setUserRole(raw.slice(colonIdx + 1));
            }
            else {
                setUserRole(raw);
            }
        }
    }, []);
    // MC-hydration: restore tab/business/feature from URL/localStorage after mount
    (0, react_1.useEffect)(function () {
        var _a = parseURL(), urlTab = _a.tab, urlBiz = _a.business;
        if (urlBiz)
            setSelectedBusiness(urlBiz);
        if (urlTab && VALID_TABS.includes(urlTab)) {
            setTab(urlTab);
        }
        else {
            try {
                var saved = localStorage.getItem('mc-tab');
                if (saved && VALID_TABS.includes(saved))
                    setTab(saved);
            }
            catch (_) { /* private browsing */ }
        }
        var p = new URLSearchParams(window.location.search);
        var feat = p.get('feature');
        if (feat)
            setBoardFeatureFilter(feat);
    }, []);
    // Auto-trigger onboarding wizard when no businesses exist (workspace not yet onboarded)
    (0, react_1.useEffect)(function () {
        fetch('/api/businesses')
            .then(function (r) { return r.json(); })
            .then(function (d) { if (Array.isArray(d) && d.length === 0)
            setShowOnboarding(true); })
            .catch(function () { });
    }, []);
    // Agent runs + issue counts polling
    (0, react_1.useEffect)(function () {
        var SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://twthgapiouiqhavrcnry.supabase.co';
        var KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        var prevRunsRef = { current: {} };
        var fetchRuns = function () {
            fetch("".concat(SUPA, "/rest/v1/agent_runs?select=agent_id,task_title,status,started_at&order=started_at.desc&limit=50"), {
                headers: { apikey: KEY, Authorization: "Bearer ".concat(KEY) }
            }).then(function (r) { return r.json(); }).then(function (rows) {
                if (!Array.isArray(rows))
                    return;
                var byAgent = {};
                for (var _i = 0, rows_1 = rows; _i < rows_1.length; _i++) {
                    var r = rows_1[_i];
                    if (!byAgent[r.agent_id])
                        byAgent[r.agent_id] = { taskTitle: (r.task_title || '').slice(0, 40), startedAt: r.started_at, status: r.status };
                }
                for (var _a = 0, _b = Object.entries(byAgent); _a < _b.length; _a++) {
                    var _c = _b[_a], agentId = _c[0], info = _c[1];
                    var prev = prevRunsRef.current[agentId];
                    var e = mc_constants_1.AGENT_EMOJI[agentId] || '🤖';
                    if (prev && prev !== info.status) {
                        if (info.status === 'running')
                            addGlobalToast("".concat(e, " ").concat(agentId, " started: ").concat(info.taskTitle), mc_constants_1.TOAST_COLORS.started);
                        else if (info.status === 'completed' || info.status === 'done')
                            addGlobalToast("".concat(e, " ").concat(agentId, " done: ").concat(info.taskTitle), mc_constants_1.TOAST_COLORS.done);
                        else if (info.status === 'error')
                            addGlobalToast("".concat(e, " ").concat(agentId, " error: ").concat(info.taskTitle), mc_constants_1.TOAST_COLORS.error);
                    }
                    prevRunsRef.current[agentId] = info.status;
                }
                setAgentRunsData(byAgent);
            }).catch(function () { });
        };
        var fetchAgentIssues = function () {
            fetch("".concat(SUPA, "/rest/v1/issues?status=in.(open,in_progress,code_review,product_review,approved,released)&sprint=not.is.null&select=assignee&limit=500"), {
                headers: { apikey: KEY, Authorization: "Bearer ".concat(KEY) }
            }).then(function (r) { return r.json(); }).then(function (rows) {
                if (!Array.isArray(rows))
                    return;
                var counts = {};
                for (var _i = 0, rows_2 = rows; _i < rows_2.length; _i++) {
                    var r = rows_2[_i];
                    if (r.assignee)
                        counts[r.assignee] = (counts[r.assignee] || 0) + 1;
                }
                setAgentIssueCounts(counts);
            }).catch(function () { });
        };
        fetchRuns();
        fetchAgentIssues();
        var iv = setInterval(function () { fetchRuns(); fetchAgentIssues(); }, 30000);
        return function () { return clearInterval(iv); };
    }, []);
    // Calendar issues
    (0, react_1.useEffect)(function () {
        var SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://twthgapiouiqhavrcnry.supabase.co';
        var KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        fetch("".concat(SUPA, "/rest/v1/issues?due_date=not.is.null&select=id,task_key,title,due_date,project,status&limit=200"), {
            headers: { apikey: KEY, Authorization: "Bearer ".concat(KEY) }
        }).then(function (r) { return r.json(); }).then(function (data) { if (Array.isArray(data))
            setCalendarIssues(data); }).catch(function () { });
    }, []);
    // Issue activity feed
    (0, react_1.useEffect)(function () {
        var SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://twthgapiouiqhavrcnry.supabase.co';
        var KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        var since = new Date(Date.now() - 7 * 86400000).toISOString();
        fetch("".concat(SUPA, "/rest/v1/issues?updated_at=gte.").concat(since, "&order=updated_at.desc&limit=200&select=task_key,title,status,assignee,updated_at,resolution_type,sprint,type"), {
            headers: { apikey: KEY, Authorization: "Bearer ".concat(KEY) }
        }).then(function (r) { return r.json(); }).then(function (data) {
            if (!Array.isArray(data))
                return;
            setIssueActivity(data.map(function (i) {
                var agoMin = Math.round((Date.now() - new Date(i.updated_at).getTime()) / 60000);
                var ai = mc_constants_1.AGENT_DISPLAY[i.assignee] || null;
                return { type: 'issue', emoji: ['completed', 'closed', 'released'].includes(i.status) ? '✅' : i.status === 'in_progress' ? '🔧' : ['code_review', 'product_review', 'approved'].includes(i.status) ? '👁' : '📋', agentId: i.assignee || 'system', agentName: (ai === null || ai === void 0 ? void 0 : ai.name) || i.assignee || 'System', channel: i.task_key, action: 'issue', desc: "".concat(i.title, " \u2192 ").concat((i.status || '').replace(/_/g, ' ')).concat(i.resolution_type ? " (".concat(i.resolution_type.replace(/_/g, ' '), ")") : ''), ago: agoMin, date: agoMin < 60 ? 'Today' : agoMin < 1440 ? 'Yesterday' : 'Earlier' };
            }));
        }).catch(function () { });
    }, [tab]);
    // Cmd+K search
    (0, react_1.useEffect)(function () {
        var h = function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            setSearchOpen(function (v) { return !v; });
        } };
        window.addEventListener('keydown', h);
        return function () { return window.removeEventListener('keydown', h); };
    }, []);
    // Cmd+[ inbox drawer
    (0, react_1.useEffect)(function () {
        var h = function (e) { if ((e.metaKey || e.ctrlKey) && e.key === '[') {
            e.preventDefault();
            setInboxOpen(function (v) { return !v; });
        } };
        window.addEventListener('keydown', h);
        return function () { return window.removeEventListener('keydown', h); };
    }, []);
    // Inbox pending count polling
    (0, react_1.useEffect)(function () {
        var fetch_ = function () {
            fetch('/api/inbox?status=pending')
                .then(function (r) { return r.json(); })
                .then(function (d) { if (Array.isArray(d))
                setInboxPendingCount(d.length); })
                .catch(function () { });
        };
        fetch_();
        var iv = setInterval(fetch_, 30000);
        return function () { return clearInterval(iv); };
    }, []);
    // Browser back/forward
    (0, react_1.useEffect)(function () {
        var onPop = function () {
            var _a = parseURL(), t = _a.tab, business = _a.business;
            if (VALID_TABS.includes(t)) {
                setTab(t);
                try {
                    localStorage.setItem('mc-tab', t);
                }
                catch (_) { }
            }
            setSelectedBusiness(business);
        };
        window.addEventListener('popstate', onPop);
        return function () { return window.removeEventListener('popstate', onPop); };
    }, []);
    // Replace initial history entry so back works correctly
    (0, react_1.useEffect)(function () {
        window.history.replaceState({ biz: selectedBusiness, tab: tab }, '', buildPath(selectedBusiness, tab));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Unread chat event
    (0, react_1.useEffect)(function () {
        var h = function () { return setUnreadChat(true); };
        window.addEventListener('mc-chat-unread', h);
        return function () { return window.removeEventListener('mc-chat-unread', h); };
    }, []);
    var _10 = (0, react_1.useState)(30), statusCountdown = _10[0], setStatusCountdown = _10[1];
    var fetchStatus = function () { fetch('/api/status').then(function (r) { return r.json(); }).then(function (d) { setLiveStatus(d); setStatusAt(Date.now()); }).catch(function () { }); };
    var fetchAgentsAndCrons = function () {
        fetch('/api/agents').then(function (r) { return r.json(); }).then(function (d) { if (Array.isArray(d))
            setLiveAgents(d); }).catch(function () { });
        fetch('/api/automations').then(function (r) { return r.json(); }).then(function (d) { if (Array.isArray(d))
            setLiveCrons(d); }).catch(function () { });
    };
    (0, react_1.useEffect)(function () { fetchStatus(); var t = setInterval(function () { fetchStatus(); setStatusCountdown(30); }, 30000); var cd = setInterval(function () { return setStatusCountdown(function (s) { return Math.max(0, s - 1); }); }, 1000); return function () { clearInterval(t); clearInterval(cd); }; }, []);
    (0, react_1.useEffect)(function () { fetchAgentsAndCrons(); var t = setInterval(function () { fetchAgentsAndCrons(); }, 60000); return function () { return clearInterval(t); }; }, []);
    (0, react_1.useEffect)(function () { if (tab !== 'office')
        return; var iv = setInterval(function () { return __awaiter(_this, void 0, void 0, function () { var res, d; return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, fetch('/api/agents')];
            case 1:
                res = _a.sent();
                if (!res.ok) return [3 /*break*/, 3];
                return [4 /*yield*/, res.json()];
            case 2:
                d = _a.sent();
                if (Array.isArray(d))
                    setLiveAgents(d);
                _a.label = 3;
            case 3: return [2 /*return*/];
        }
    }); }); }, 30000); return function () { return clearInterval(iv); }; }, [tab]);
    (0, react_1.useEffect)(function () { if (!statusAt)
        return; var t = setInterval(function () { return setAgoSec(Math.floor((Date.now() - statusAt) / 1000)); }, 1000); return function () { return clearInterval(t); }; }, [statusAt]);
    (0, react_1.useEffect)(function () { var t = setInterval(function () { return setClock(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/New_York' }) + ' ET'); }, 1000); return function () { return clearInterval(t); }; }, []);
    (0, react_1.useEffect)(function () { fetch('/api/projects').then(function (r) { return r.json(); }).then(function (d) { if (Array.isArray(d) && d.length > 0)
        setProjects(d); }).catch(function () { }); }, []);
    (0, react_1.useEffect)(function () { fetch('/api/memory').then(function (r) { return r.json(); }).then(function (d) { return setMemFiles(d.files || []); }); }, []);
    (0, react_1.useEffect)(function () { var t = setInterval(function () { return setFeedIdx(function (i) { return (i + 1) % mc_constants_1.LIVE_FEED.length; }); }, 4000); return function () { return clearInterval(t); }; }, []);
    (0, react_1.useEffect)(function () { var t = setInterval(function () { return setTick(function (n) { return n + 1; }); }, 3000); return function () { return clearInterval(t); }; }, []);
    var sprintProjects = projects !== null && projects !== void 0 ? projects : mc_constants_1.DEFAULT_SPRINT_PROJECTS;
    var nextRuns = (0, mc_constants_1.getNextRuns)(mc_constants_1.CRONS);
    var agentCurrentTask = (_a = liveStatus === null || liveStatus === void 0 ? void 0 : liveStatus.agentCurrentTask) !== null && _a !== void 0 ? _a : {};
    var act = function (id) { if (agentCurrentTask[id])
        return agentCurrentTask[id]; var a = mc_constants_1.ACTIVITIES[id] || ['Idle']; return a[tick % a.length]; };
    var agentLiveStatus = function (agentId) {
        var _a;
        var ar = agentRunsData[agentId];
        if (ar === null || ar === void 0 ? void 0 : ar.startedAt) {
            var mins = Math.round((Date.now() - new Date(ar.startedAt).getTime()) / 60000);
            if (ar.status === 'running' || mins < 5)
                return { dot: 'green', label: ar.taskTitle || 'Working...' };
        }
        if (((_a = agentIssueCounts[agentId]) !== null && _a !== void 0 ? _a : 0) > 0)
            return { dot: 'amber', label: "".concat(agentIssueCounts[agentId], " open issue").concat(agentIssueCounts[agentId] > 1 ? 's' : '') };
        return { dot: 'grey', label: 'Idle' };
    };
    var displayAgents = (liveAgents && liveAgents.length > 0 ? liveAgents : mc_constants_1.ALL_AGENTS);
    var displayCrons = (liveCrons && liveCrons.length > 0 ? liveCrons : mc_constants_1.CRONS);
    var pushURL = (0, react_1.useCallback)(function (biz, t) {
        var path = buildPath(biz, t);
        if (window.location.pathname !== path)
            window.history.pushState({ biz: biz, tab: t }, '', path);
    }, []);
    var navigate = (0, react_1.useCallback)(function (t) {
        setTab(t);
        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem('mc-tab', t);
            }
            catch (_) { /* private browsing */ }
            pushURL(selectedBusiness, t);
        }
    }, [selectedBusiness, pushURL]);
    var selectBusiness = (0, react_1.useCallback)(function (name) {
        setSelectedBusiness(name);
        pushURL(name, tab);
    }, [tab, pushURL]);
    return (<div className="min-h-screen flex bg-neutral-950">
      <BusinessRail_1.default selected={selectedBusiness} onSelect={selectBusiness} onNew={function () { return setShowOnboarding(true); }} refreshKey={businessRailRefresh}/>
      {showOnboarding && <OnboardingWizard_1.default onComplete={function (name) { selectBusiness(name); setShowOnboarding(false); setBusinessRailRefresh(function (k) { return k + 1; }); }} onClose={function () { return setShowOnboarding(false); }}/>}

      {/* SIDEBAR — TOD-538: grouped nav extracted to SidebarNav component */}
      <SidebarNav_1.default tab={tab} navigate={navigate} unreadChat={unreadChat} setUnreadChat={setUnreadChat} clock={clock} onSearchOpen={function () { return setSearchOpen(true); }} selectedBusiness={selectedBusiness} onSelectBusiness={selectBusiness} onNewBusiness={function () { return setShowOnboarding(true); }} businessRailRefresh={businessRailRefresh}/>

      {/* MOBILE BOTTOM NAV */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-neutral-950 border-t border-white/10 flex justify-around px-1" style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
        {['overview', 'board', 'office', 'chat', 'calendar'].map(function (id) {
            var item = NAV.find(function (n) { return n.id === id; });
            var LIcon = LUCIDE_ICONS[id];
            if (!item)
                return null;
            return <button key={id} onClick={function () { navigate(id); setShowMobileMore(false); if (id === 'chat')
                setUnreadChat(false); }} className={'flex flex-col items-center gap-0.5 px-2 py-2 min-w-0 flex-1 text-xs transition-colors ' + (tab === id ? 'text-white' : 'text-white/50')}>
            {LIcon ? <LIcon size={18}/> : <span>{item.icon}</span>}<span className="text-[9px]">{item.label.split(' ')[0]}</span>
          </button>;
        })}
        <button onClick={function () { return setShowMobileMore(function (v) { return !v; }); }} className={'flex flex-col items-center gap-0.5 px-2 py-2 flex-1 text-xs transition-colors ' + (showMobileMore ? 'text-white' : 'text-white/50')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          <span className="text-[9px]">More</span>
        </button>
      </nav>
      {showMobileMore && (<div className="lg:hidden fixed bottom-[56px] left-0 right-0 z-50 border-t border-white/10 bg-neutral-950">
          {/* TOD-1197: Hub switcher — mobile More menu */}
          <div className="px-2 py-2 border-b border-white/[0.07]">
            <p className="px-1 mb-1 text-[9px] font-semibold uppercase tracking-widest text-white/20 select-none">Hub</p>
            <HubSwitcher_1.default selected={selectedBusiness} onSelect={function (name) { selectBusiness(name); setShowMobileMore(false); }} onNew={function () { setShowOnboarding(true); setShowMobileMore(false); }} refreshKey={businessRailRefresh}/>
          </div>
          <div className="grid grid-cols-3 gap-px p-2">
            {NAV.filter(function (n) { return n.id !== 'divider' && !['overview', 'board', 'office', 'chat', 'calendar'].includes(n.id); }).map(function (item) {
                var LIcon = LUCIDE_ICONS[item.id];
                return <button key={item.id} onClick={function () { navigate(item.id); setShowMobileMore(false); if (item.id === 'chat')
                    setUnreadChat(false); }} className={'flex flex-col items-center gap-1 p-3 rounded-xl text-xs ' + (tab === item.id ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5')}>
                {LIcon ? <LIcon size={20}/> : <span className="text-lg">{item.icon}</span>}<span className="text-[10px]">{item.label}</span>
              </button>;
            })}
          </div>
        </div>)}

      {/* MAIN */}
      <div className="flex-1 flex flex-col h-screen overflow-auto">
        {/* TOD-630: Top bar — logo left, search center, actions right */}
        <TopBar_1.default tab={tab} selectedBusiness={selectedBusiness} onSearchOpen={function () { return setSearchOpen(true); }} onNavigate={navigate} agentRunsData={agentRunsData} unreadChat={unreadChat} inboxPendingCount={inboxPendingCount} onOpenInbox={function () { return setInboxOpen(true); }}/>

        {/* Business context header */}
        {selectedBusiness && (<div className="px-4 md:px-6 py-3 border-b border-white/10 bg-[#0a0a0a]">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{BIZ_EMOJI[selectedBusiness] || '🏢'}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-white text-sm font-semibold truncate">{selectedBusiness}</h2>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/50 font-medium">Business</span>
                  <span className="flex items-center gap-1 text-[9px] text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"/>Active</span>
                </div>
                <p className="text-white/30 text-[10px] mt-0.5">Viewing all {selectedBusiness} data across tabs</p>
              </div>
            </div>
          </div>)}

        <main className="flex-1 px-4 md:px-6 py-5 pb-20 lg:pb-5 overflow-x-hidden">
          {tab === 'overview' && <OverviewTab_1.default globalSync={globalSync} syncing={syncing} liveStatus={liveStatus} sprintProjects={sprintProjects} onNavigate={navigate} projectFilter={selectedBusiness}/>}
          {tab === 'activity' && <ActivityTab_1.default liveStatus={liveStatus} statusAt={statusAt} setLiveStatus={setLiveStatus} setStatusAt={setStatusAt} issueActivity={issueActivity} displayAgents={displayAgents} projectFilter={selectedBusiness}/>}
          {tab === 'team' && <CrewTab_1.default userRole={userRole} currentIdentity={currentIdentity} displayAgents={displayAgents} agentLiveStatus={agentLiveStatus} agentRunsData={agentRunsData} liveAgents={liveAgents} act={act} agentModal={agentModal} setAgentModal={setAgentModal} projectFilter={selectedBusiness}/>}
          {tab === 'calendar' && <CalendarTab_1.default calendarIssues={calendarIssues} sprintProjects={sprintProjects} calendarView={calendarView} setCalendarView={setCalendarView} displayCrons={displayCrons} nextRuns={nextRuns} cronModal={cronModal} setCronModal={setCronModal} projectFilter={selectedBusiness}/>}
          {tab === 'office' && <OfficeTab_1.default agentRunsData={agentRunsData}/>}
          {tab === 'memory' && <MemoryTab_1.default memFiles={memFiles} openMem={openMem} setOpenMem={setOpenMem}/>}
          {tab === 'board' && <BoardTab_1.default featureFilter={boardFeatureFilter} featureFilterName={boardFeatureFilterName} onClearFeatureFilter={function () { setBoardFeatureFilter(undefined); setBoardFeatureFilterName(undefined); }} projectFilter={selectedBusiness}/>}
          {tab === 'features' && <FeaturesTab_1.default onViewIssues={function (featureId, featureName) { setBoardFeatureFilter(featureId); setBoardFeatureFilterName(featureName); navigate('board'); }} projectFilter={selectedBusiness}/>}
          {tab === 'pipeline' && <PipelineTab_1.default projectFilter={selectedBusiness}/>}
          {tab === 'issues' && <IssuesTab_1.default projectFilter={selectedBusiness}/>}
          {tab === 'projects' && <ProjectsTab_1.default projectFilter={selectedBusiness}/>}
          {tab === 'automations' && <AutomationsTab_1.default displayCrons={displayCrons}/>}
          {tab === 'chat' && <ChatTab_1.default selectedBusiness={selectedBusiness}/>}
          {tab === 'infra' && <InfraTab_1.default liveStatus={liveStatus} agoSec={agoSec} statusCountdown={statusCountdown} onRefresh={function () { fetchStatus(); setStatusCountdown(30); }}/>}
          {tab === 'product-board' && <ProductBoardTab_1.default projectFilter={selectedBusiness}/>}
          {tab === 'settings' && <SettingsTab_1.default />}
          {tab === 'epic-map' && <EpicMapTab_1.default />}
          {tab === 'ai-services' && <AIServicesTab_1.default />}
          {tab === 'inbox' && <InboxTab_1.default />}
        </main>
      </div>

      <QuickActionFab_1.default onNavigate={navigate} onCreateIssue={function () { return navigate('board'); }} onStartChat={function () { return navigate('chat'); }}/>
      <SearchOverlay_1.default open={searchOpen} onClose={function () { return setSearchOpen(false); }} onNavigate={navigate}/>
      <InboxDrawer_1.default open={inboxOpen} onClose={function () { return setInboxOpen(false); }} pendingCount={inboxPendingCount}/>
      {globalToasts.length > 0 && (<div className="fixed bottom-[72px] right-4 z-[9999] flex flex-col gap-1.5 pointer-events-none">
          {globalToasts.map(function (t) { return (<div key={t.id} className="bg-neutral-950/95 border rounded-lg px-3.5 py-2 text-[11px] max-w-[280px] shadow-lg" style={{ borderColor: t.color + '40', borderLeftWidth: 3, borderLeftColor: t.color, color: t.color }}>
              {t.text}
            </div>); })}
        </div>)}
    </div>);
}
