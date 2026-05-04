'use client';
"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AgentDetailView;
var react_1 = require("react");
var mc_atoms_1 = require("@/lib/mc-atoms");
var ui_1 = require("@/components/ui");
var lucide_react_1 = require("lucide-react");
var TABS = [
    { id: 'dashboard', label: 'Dashboard', icon: lucide_react_1.LayoutDashboard },
    { id: 'instructions', label: 'Instructions', icon: lucide_react_1.BookOpen },
    { id: 'skills', label: 'Skills', icon: lucide_react_1.Zap },
    { id: 'configuration', label: 'Configuration', icon: lucide_react_1.Settings },
    { id: 'runs', label: 'Runs', icon: lucide_react_1.PlayCircle },
    { id: 'budget', label: 'Budget', icon: lucide_react_1.DollarSign },
];
// ── Helpers ───────────────────────────────────────────────────────────────────
function statusColor(s) {
    if (s === 'in_progress')
        return 'text-amber-400';
    if (s === 'code_review')
        return 'text-purple-400';
    if (s === 'open')
        return 'text-blue-400';
    if (s === 'closed' || s === 'completed' || s === 'released')
        return 'text-emerald-400';
    if (s === 'backlog')
        return 'text-white/30';
    return 'text-white/50';
}
function priorityBadge(p) {
    var cls = p === 'critical' ? 'bg-red-500/20 text-red-400 border-red-500/30'
        : p === 'high' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
            : p === 'medium' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                : 'bg-white/5 text-white/40 border-white/10';
    return <span className={"text-[9px] px-1.5 py-0.5 rounded-full border font-semibold uppercase ".concat(cls)}>{p}</span>;
}
function relTime(ms) {
    if (!ms)
        return 'Never';
    var diff = Math.round((Date.now() - ms) / 60000);
    if (diff < 1)
        return 'Just now';
    if (diff < 60)
        return "".concat(diff, "m ago");
    if (diff < 1440)
        return "".concat(Math.round(diff / 60), "h ago");
    return "".concat(Math.round(diff / 1440), "d ago");
}
// ── Markdown renderer (simple) ────────────────────────────────────────────────
function SimpleMarkdown(_a) {
    var content = _a.content;
    if (!content)
        return <p className="text-white/30 text-sm italic">No content available.</p>;
    var lines = content.split('\n');
    return (<div className="space-y-1 text-sm leading-relaxed">
      {lines.map(function (line, i) {
            var _a;
            if (line.startsWith('# '))
                return <h1 key={i} className="text-white font-bold text-base mt-4 mb-1">{line.slice(2)}</h1>;
            if (line.startsWith('## '))
                return <h2 key={i} className="text-white/80 font-semibold text-sm mt-3 mb-1">{line.slice(3)}</h2>;
            if (line.startsWith('### '))
                return <h3 key={i} className="text-white/70 font-semibold text-xs mt-2 mb-0.5 uppercase tracking-wider">{line.slice(4)}</h3>;
            if (line.startsWith('- ') || line.startsWith('* '))
                return <div key={i} className="flex gap-2 text-white/60"><span className="text-white/30 shrink-0">•</span><span>{line.slice(2)}</span></div>;
            if (line.startsWith('> '))
                return <blockquote key={i} className="border-l-2 border-white/20 pl-3 text-white/50 italic">{line.slice(2)}</blockquote>;
            if (line.match(/^[0-9]+\. /))
                return <div key={i} className="flex gap-2 text-white/60 ml-2"><span className="text-white/30 shrink-0">{(_a = line.match(/^[0-9]+/)) === null || _a === void 0 ? void 0 : _a[0]}.</span><span>{line.replace(/^[0-9]+\. /, '')}</span></div>;
            if (line.trim() === '')
                return <div key={i} className="h-1"/>;
            if (line.startsWith('```'))
                return <div key={i} className="text-white/20 text-[10px] font-mono">{line}</div>;
            return <p key={i} className="text-white/60">{line}</p>;
        })}
    </div>);
}
// ── Tab: Dashboard ────────────────────────────────────────────────────────────
function DashboardTab(_a) {
    var agent = _a.agent;
    var _b = (0, react_1.useState)([]), issues = _b[0], setIssues = _b[1];
    var _c = (0, react_1.useState)(true), loading = _c[0], setLoading = _c[1];
    (0, react_1.useEffect)(function () {
        fetch("/api/issues?assignee=".concat(encodeURIComponent(agent.id), "&limit=0"))
            .then(function (r) { return r.json(); })
            .then(function (data) {
            var _a;
            setIssues(Array.isArray(data) ? data : (_a = data === null || data === void 0 ? void 0 : data.data) !== null && _a !== void 0 ? _a : []);
        })
            .catch(function () { })
            .finally(function () { return setLoading(false); });
    }, [agent.id]);
    var inProgress = issues.filter(function (i) { return i.status === 'in_progress'; }).length;
    var inReview = issues.filter(function (i) { return i.status === 'code_review'; }).length;
    var open = issues.filter(function (i) { return i.status === 'open'; }).length;
    var active = issues.filter(function (i) { return ['in_progress', 'code_review', 'open'].includes(i.status); });
    var isRunning = agent.status === 'running';
    return (<div className="space-y-5">
      {/* Live Run indicator */}
      <div className={"flex items-center gap-2 px-3 py-2 rounded-lg border ".concat(isRunning
            ? 'border-emerald-500/30 bg-emerald-500/10'
            : 'border-white/10 bg-[#0f0f0f]')}>
        <span className={"inline-block w-2 h-2 rounded-full ".concat(isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-white/20')}/>
        <span className={"text-xs font-medium ".concat(isRunning ? 'text-emerald-400' : 'text-white/40')}>
          {isRunning ? "Running \u2014 ".concat(relTime(agent.lastUpdatedAt)) : 'Idle'}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        {[
            { label: 'In Progress', value: inProgress, icon: lucide_react_1.Activity, color: 'text-amber-400' },
            { label: 'In Review', value: inReview, icon: lucide_react_1.Code2, color: 'text-purple-400' },
            { label: 'Open', value: open, icon: lucide_react_1.AlertCircle, color: 'text-blue-400' },
            { label: 'Cost this week', value: '—', icon: lucide_react_1.DollarSign, color: 'text-white/40' },
        ].map(function (s) { return (<div key={s.label} className="bg-[#0f0f0f] border border-white/10 rounded-xl p-4">
            <s.icon size={14} className={"".concat(s.color, " mb-1")}/>
            <p className={"text-xl font-bold ".concat(s.color)}>{s.value}</p>
            <p className="text-white/30 text-[10px]">{s.label}</p>
          </div>); })}
      </div>

      {/* Last active */}
      <div className="flex items-center gap-2 text-white/40 text-xs">
        <lucide_react_1.Clock size={12}/>
        <span>Last active: <span className="text-white/60">{relTime(agent.lastUpdatedAt)}</span></span>
        {agent.currentTask && (<span className="ml-2 text-emerald-400/70 truncate max-w-[200px]">↳ {agent.currentTask}</span>)}
      </div>

      {/* Charts placeholder row */}
      <div className="grid grid-cols-2 gap-3">
        {['Run Activity', 'Issues by Priority', 'Issues by Status', 'Success Rate'].map(function (title) { return (<div key={title} className="rounded-xl border border-white/10 p-4 bg-[#0f0f0f]">
            <div className="flex items-center gap-2 mb-3">
              <lucide_react_1.BarChart3 size={14} className="text-white/30"/>
              <p className="text-white/50 text-xs font-semibold">{title}</p>
            </div>
            <p className="text-white/20 text-xs italic">Chart coming soon</p>
          </div>); })}
      </div>

      {/* Active issues list */}
      <div>
        <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Active Issues</p>
        {loading && <p className="text-white/20 text-xs">Loading…</p>}
        {!loading && active.length === 0 && (<p className="text-white/20 text-xs italic">No active issues assigned.</p>)}
        <div className="space-y-2">
          {active.slice(0, 10).map(function (issue) { return (<div key={issue.id} className="flex items-center gap-3 rounded-lg px-3 py-2 border border-white/10 bg-[#0f0f0f]">
              <lucide_react_1.CheckCircle2 size={12} className={statusColor(issue.status)}/>
              <div className="flex-1 min-w-0">
                <p className="text-white/70 text-xs truncate">{issue.title}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {issue.task_key && <span className="text-[9px] text-white/30 font-mono">{issue.task_key}</span>}
                  <span className={"text-[9px] ".concat(statusColor(issue.status))}>{issue.status.replace('_', ' ')}</span>
                </div>
              </div>
              {issue.priority && priorityBadge(issue.priority)}
            </div>); })}
        </div>
      </div>
    </div>);
}
// ── Tab: Instructions ─────────────────────────────────────────────────────────
function InstructionsTab(_a) {
    var _b;
    var agent = _a.agent;
    var _c = (0, react_1.useState)(null), files = _c[0], setFiles = _c[1];
    var _d = (0, react_1.useState)(true), loading = _d[0], setLoading = _d[1];
    var _e = (0, react_1.useState)('soul'), activeFile = _e[0], setActiveFile = _e[1];
    var _f = (0, react_1.useState)(false), isEditing = _f[0], setIsEditing = _f[1];
    var _g = (0, react_1.useState)(''), editContent = _g[0], setEditContent = _g[1];
    var _h = (0, react_1.useState)(''), saveError = _h[0], setSaveError = _h[1];
    (0, react_1.useEffect)(function () {
        fetch("/api/agents/".concat(agent.id, "/files"))
            .then(function (r) { return r.json(); })
            .then(setFiles)
            .catch(function () { return setFiles({ soul: '', heartbeat: '', agents: '' }); })
            .finally(function () { return setLoading(false); });
    }, [agent.id]);
    // Reset edit mode on file tab switch
    (0, react_1.useEffect)(function () {
        setIsEditing(false);
        setSaveError('');
    }, [activeFile]);
    function startEditing() {
        var _a;
        setEditContent((_a = files === null || files === void 0 ? void 0 : files[activeFile]) !== null && _a !== void 0 ? _a : '');
        setSaveError('');
        setIsEditing(true);
    }
    function cancelEditing() {
        setIsEditing(false);
        setSaveError('');
    }
    function saveFile() {
        setSaveError('');
        fetch("/api/agents/".concat(agent.id, "/files"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: activeFile, content: editContent }),
        })
            .then(function (r) {
            if (!r.ok)
                throw new Error('Save failed');
            return r.json();
        })
            .then(function () {
            setFiles(function (prev) {
                var _a;
                return prev ? __assign(__assign({}, prev), (_a = {}, _a[activeFile] = editContent, _a)) : prev;
            });
            setIsEditing(false);
        })
            .catch(function () { return setSaveError('Failed to save'); });
    }
    var tabs = [
        { key: 'soul', label: 'SOUL.md', icon: '🧠' },
        { key: 'heartbeat', label: 'HEARTBEAT.md', icon: '💓' },
        { key: 'agents', label: 'AGENTS.md', icon: '📋' },
    ];
    return (<div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex gap-2 flex-1">
          {tabs.map(function (t) { return (<button key={t.key} onClick={function () { return setActiveFile(t.key); }} className={"px-2.5 py-1 rounded-lg text-xs border transition-colors focus:outline-none focus:ring-2 focus:ring-white/30 ".concat(activeFile === t.key
                ? 'border-white/20 bg-white/10 text-white'
                : 'border-white/10 bg-transparent text-white/40 hover:text-white/60')}>
              {t.icon} {t.label}
            </button>); })}
        </div>
        {!isEditing && (<ui_1.Button variant="ghost" size="sm" onClick={startEditing}>
            <lucide_react_1.Edit3 size={12} className="mr-1"/> Edit
          </ui_1.Button>)}
      </div>

      <div className="rounded-xl border border-white/10 p-4 min-h-[300px] overflow-y-auto max-h-[500px] bg-[#080808]">
        {loading ? (<p className="text-white/20 text-xs">Loading…</p>) : isEditing ? (<div className="space-y-3">
            <textarea className="w-full min-h-[280px] bg-transparent text-white/70 text-sm font-mono resize-y outline-none border border-white/10 rounded-lg p-3" value={editContent} onChange={function (e) { return setEditContent(e.target.value); }}/>
            {saveError && <p className="text-red-400 text-xs">{saveError}</p>}
            <div className="flex gap-2">
              <ui_1.Button variant="primary" size="sm" onClick={saveFile}>
                <lucide_react_1.Save size={12} className="mr-1"/> Save
              </ui_1.Button>
              <ui_1.Button variant="ghost" size="sm" onClick={cancelEditing}>
                Cancel
              </ui_1.Button>
            </div>
          </div>) : (<SimpleMarkdown content={(_b = files === null || files === void 0 ? void 0 : files[activeFile]) !== null && _b !== void 0 ? _b : ''}/>)}
      </div>
    </div>);
}
// ── Tab: Skills ───────────────────────────────────────────────────────────────
function SkillsTab(_a) {
    var agent = _a.agent;
    var _b = (0, react_1.useState)([]), skills = _b[0], setSkills = _b[1];
    var _c = (0, react_1.useState)(true), loading = _c[0], setLoading = _c[1];
    (0, react_1.useEffect)(function () {
        fetch('/api/status')
            .then(function (r) { return r.json(); })
            .then(function (data) {
            var _a, _b, _c;
            var agentSkills = (_c = (_a = data === null || data === void 0 ? void 0 : data.skills) !== null && _a !== void 0 ? _a : (_b = data === null || data === void 0 ? void 0 : data.agents) === null || _b === void 0 ? void 0 : _b.skills) !== null && _c !== void 0 ? _c : [];
            if (Array.isArray(agentSkills)) {
                setSkills(agentSkills);
            }
            else {
                // Fallback: parse skills from the capabilities of the agent
                setSkills(agent.capabilities.map(function (c) { return ({ name: c, description: '', location: '' }); }));
            }
        })
            .catch(function () {
            setSkills(agent.capabilities.map(function (c) { return ({ name: c, description: '', location: '' }); }));
        })
            .finally(function () { return setLoading(false); });
    }, [agent.id]);
    // Also list capabilities as built-in
    var builtIn = agent.capabilities.map(function (c) { return ({ name: c, description: "Built-in capability: ".concat(c), location: 'system', builtin: true }); });
    return (<div className="space-y-4">
      <div>
        <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Built-in Capabilities</p>
        <div className="space-y-2">
          {builtIn.map(function (s) { return (<div key={s.name} className="flex items-start gap-3 rounded-lg px-3 py-2 border border-white/10 bg-[#0f0f0f]">
              <lucide_react_1.Zap size={12} className="text-amber-400 mt-0.5 shrink-0"/>
              <div>
                <p className="text-white/70 text-xs font-medium">{s.name}</p>
                {s.description && <p className="text-white/30 text-[10px] mt-0.5">{s.description}</p>}
              </div>
            </div>); })}
        </div>
      </div>

      {!loading && skills.length > 0 && (<div>
          <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Installed Skills</p>
          <div className="space-y-2">
            {skills.map(function (s, i) {
                var _a, _b;
                return (<div key={i} className="flex items-start gap-3 rounded-lg px-3 py-2 border border-white/10 bg-[#0f0f0f]">
                <lucide_react_1.FileText size={12} className="text-blue-400 mt-0.5 shrink-0"/>
                <div>
                  <p className="text-white/70 text-xs font-medium">{(_b = (_a = s.name) !== null && _a !== void 0 ? _a : s.id) !== null && _b !== void 0 ? _b : "Skill ".concat(i + 1)}</p>
                  {s.description && <p className="text-white/30 text-[10px] mt-0.5">{s.description}</p>}
                  {s.location && <p className="text-white/20 text-[9px] font-mono mt-0.5">{s.location}</p>}
                </div>
              </div>);
            })}
          </div>
        </div>)}
      {loading && <p className="text-white/20 text-xs">Loading skills…</p>}
    </div>);
}
// ── Tab: Configuration ────────────────────────────────────────────────────────
function ConfigurationTab(_a) {
    var _b, _c, _d, _e;
    var agent = _a.agent;
    var _f = (0, react_1.useState)(null), config = _f[0], setConfig = _f[1];
    var _g = (0, react_1.useState)(true), loading = _g[0], setLoading = _g[1];
    (0, react_1.useEffect)(function () {
        fetch('/api/status')
            .then(function (r) { return r.json(); })
            .then(function (data) {
            var _a, _b;
            var agentsList = (_b = (_a = data === null || data === void 0 ? void 0 : data.agents) === null || _a === void 0 ? void 0 : _a.agents) !== null && _b !== void 0 ? _b : [];
            var found = agentsList.find(function (a) { return a.id === agent.id; });
            setConfig(found !== null && found !== void 0 ? found : null);
        })
            .catch(function () { })
            .finally(function () { return setLoading(false); });
    }, [agent.id]);
    var heartbeatCfg = (_b = config === null || config === void 0 ? void 0 : config.heartbeat) !== null && _b !== void 0 ? _b : {};
    var workspacePath = (_d = (_c = config === null || config === void 0 ? void 0 : config.workspaceDir) !== null && _c !== void 0 ? _c : agent.workspace) !== null && _d !== void 0 ? _d : '';
    var rows = [
        { label: 'Default Model', value: (_e = config === null || config === void 0 ? void 0 : config.model) !== null && _e !== void 0 ? _e : agent.model },
        { label: 'Model (fallback)', value: 'See AGENTS.md routing table' },
        { label: 'Model (escalate)', value: 'See AGENTS.md routing table' },
        { label: 'Heartbeat', value: heartbeatCfg.every ? "Every ".concat(heartbeatCfg.every) : 'Disabled' },
        { label: 'Workspace', value: workspacePath },
        { label: 'Sessions', value: (config === null || config === void 0 ? void 0 : config.sessionsCount) != null ? String(config.sessionsCount) : '—' },
        { label: 'Agent ID', value: agent.id },
    ];
    return (<div className="space-y-3">
      {loading && <p className="text-white/20 text-xs">Loading…</p>}
      {rows.map(function (r) {
            var _a;
            return (<div key={r.label} className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5 border border-white/10 bg-[#0f0f0f]">
          <p className="text-white/30 text-[10px] uppercase tracking-wider">{r.label}</p>
          <p className="text-white/70 text-xs font-mono break-all">{(_a = r.value) !== null && _a !== void 0 ? _a : '—'}</p>
        </div>);
        })}
    </div>);
}
// ── Tab: Runs ─────────────────────────────────────────────────────────────────
function RunsTab(_a) {
    var agent = _a.agent;
    var _b = (0, react_1.useState)('task'), subTab = _b[0], setSubTab = _b[1];
    var _c = (0, react_1.useState)([]), runs = _c[0], setRuns = _c[1];
    var _d = (0, react_1.useState)(true), loading = _d[0], setLoading = _d[1];
    (0, react_1.useEffect)(function () {
        fetch("/api/agents/".concat(agent.id, "/runs"))
            .then(function (r) {
            if (!r.ok)
                throw new Error('No runs');
            return r.json();
        })
            .then(function (data) { return setRuns(Array.isArray(data) ? data : []); })
            .catch(function () { return setRuns([]); })
            .finally(function () { return setLoading(false); });
    }, [agent.id]);
    var lastActiveStr = relTime(agent.lastUpdatedAt);
    var hasActivity = agent.lastUpdatedAt && agent.lastUpdatedAt > 0;
    var filteredRuns = runs.filter(function (r) { return subTab === 'heartbeat' ? r.type === 'heartbeat' : r.type !== 'heartbeat'; });
    return (<div className="space-y-4">
      {/* Sub-tab pills */}
      <div className="flex gap-2">
        {['task', 'heartbeat'].map(function (t) { return (<button key={t} onClick={function () { return setSubTab(t); }} className={"px-3 py-1 rounded-full text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-white/30 ".concat(subTab === t
                ? 'bg-white/10 text-white border border-white/20'
                : 'text-white/40 hover:text-white/60 border border-transparent')}>
            {t === 'task' ? 'Task Runs' : 'Heartbeat Runs'}
          </button>); })}
      </div>

      {/* Last Session card */}
      {hasActivity && (<div className="rounded-xl border border-white/10 p-4 bg-[#0f0f0f]">
          <div className="flex items-center gap-2 mb-3">
            <lucide_react_1.Activity size={14} className="text-emerald-400"/>
            <p className="text-white/70 text-xs font-semibold">Last Session</p>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-white/30">Last active</span>
              <span className="text-white/60">{lastActiveStr}</span>
            </div>
            {agent.currentTask && (<div className="flex justify-between text-xs">
                <span className="text-white/30">Current task</span>
                <span className="text-white/60 truncate max-w-[60%]">{agent.currentTask}</span>
              </div>)}
            <div className="flex justify-between text-xs">
              <span className="text-white/30">Model</span>
              <span className="text-white/60 font-mono">{agent.modelShort}</span>
            </div>
          </div>
        </div>)}

      {/* Runs list */}
      {loading ? (<p className="text-white/20 text-xs">Loading…</p>) : filteredRuns.length > 0 ? (<div className="space-y-2">
          {filteredRuns.map(function (run, i) {
                var _a, _b, _c, _d;
                return (<div key={(_a = run.id) !== null && _a !== void 0 ? _a : i} className="flex items-center gap-3 rounded-lg px-3 py-2 border border-white/10 bg-[#0f0f0f]">
              <lucide_react_1.PlayCircle size={12} className="text-white/30"/>
              <div className="flex-1 min-w-0">
                <p className="text-white/70 text-xs truncate">{(_c = (_b = run.title) !== null && _b !== void 0 ? _b : run.task) !== null && _c !== void 0 ? _c : "Run #".concat(i + 1)}</p>
                <p className="text-white/30 text-[10px]">{run.created_at ? relTime(new Date(run.created_at).getTime()) : '—'}</p>
              </div>
              <span className={"text-[9px] px-1.5 py-0.5 rounded-full border font-semibold ".concat(run.status === 'success' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        : run.status === 'failed' ? 'bg-red-500/20 text-red-400 border-red-500/30'
                            : 'bg-white/5 text-white/40 border-white/10')}>{(_d = run.status) !== null && _d !== void 0 ? _d : 'unknown'}</span>
            </div>);
            })}
        </div>) : (<div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <lucide_react_1.PlayCircle size={32} className="text-white/20"/>
          <p className="text-white/40 text-sm">No run history yet</p>
          <p className="text-white/20 text-xs">Run data will appear here once the agent has been active.</p>
        </div>)}
    </div>);
}
// ── Tab: Budget ───────────────────────────────────────────────────────────────
function BudgetTab(_a) {
    var _b, _c, _d;
    var agent = _a.agent;
    var _e = (0, react_1.useState)(''), budgetLimit = _e[0], setBudgetLimit = _e[1];
    var _f = (0, react_1.useState)(null), config = _f[0], setConfig = _f[1];
    (0, react_1.useEffect)(function () {
        fetch('/api/status')
            .then(function (r) { return r.json(); })
            .then(function (data) {
            var _a, _b;
            var agentsList = (_b = (_a = data === null || data === void 0 ? void 0 : data.agents) === null || _a === void 0 ? void 0 : _a.agents) !== null && _b !== void 0 ? _b : [];
            var found = agentsList.find(function (a) { return a.id === agent.id; });
            setConfig(found !== null && found !== void 0 ? found : null);
        })
            .catch(function () { });
    }, [agent.id]);
    // Calculate projected monthly cost
    var heartbeatEvery = (_c = (_b = config === null || config === void 0 ? void 0 : config.heartbeat) === null || _b === void 0 ? void 0 : _b.everyMinutes) !== null && _c !== void 0 ? _c : 60;
    var avgTokens = 2000;
    var modelRates = {
        'claude-haiku-4-5': 0.80,
        'claude-sonnet-4-6': 3.00,
    };
    var rate = (_d = modelRates[agent.model]) !== null && _d !== void 0 ? _d : 3.00;
    var projected = ((1440 / heartbeatEvery) * 30 * avgTokens / 1000000 * rate).toFixed(2);
    function saveBudgetLimit() {
        fetch("/api/agents/".concat(agent.id, "/config"), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ budgetLimit: Number(budgetLimit) }),
        })
            .then(function (r) { if (!r.ok)
            throw new Error('Failed'); })
            .catch(function () { return alert('Failed to save budget limit'); });
    }
    return (<div className="space-y-5">
      <p className="text-white/50 text-xs font-semibold uppercase tracking-wider">Budget &amp; Token Usage</p>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
            { label: 'This Week', value: '—' },
            { label: 'This Month', value: '—' },
            { label: 'Projected Monthly', value: "$".concat(projected) },
        ].map(function (s) { return (<div key={s.label} className="bg-[#0f0f0f] border border-white/10 rounded-xl p-4">
            <p className="text-white/30 text-[10px] mb-1">{s.label}</p>
            <p className="text-white/70 text-lg font-bold">{s.value}</p>
          </div>); })}
      </div>

      {/* Projection formula */}
      <div className="rounded-xl border border-white/10 p-3 bg-[#0f0f0f]">
        <p className="text-white/30 text-[10px] mb-1">Projection formula</p>
        <p className="text-white/40 text-[10px] font-mono">
          (1440/{heartbeatEvery}) × 30 × {avgTokens} / 1M × ${rate.toFixed(2)} = ${projected}/mo
        </p>
      </div>

      {/* Budget limit */}
      <div className="rounded-xl border border-white/10 p-4 space-y-3 bg-[#0f0f0f]">
        <p className="text-white/50 text-xs font-semibold">Budget Limit</p>
        <div className="flex gap-2">
          <ui_1.Input type="number" placeholder="No limit set" value={budgetLimit} onChange={function (e) { return setBudgetLimit(e.target.value); }} className="flex-1"/>
          <ui_1.Button variant="secondary" size="sm" onClick={saveBudgetLimit}>Save</ui_1.Button>
        </div>
      </div>

      {/* Token breakdown */}
      <div className="rounded-xl border border-white/10 p-4 bg-[#0f0f0f]">
        <p className="text-white/50 text-xs font-semibold mb-3">Token Breakdown</p>
        <div className="space-y-2">
          {['Input tokens', 'Output tokens', 'Cached'].map(function (label) { return (<div key={label} className="flex justify-between text-xs">
              <span className="text-white/30">{label}</span>
              <span className="text-white/50 font-mono">—</span>
            </div>); })}
        </div>
      </div>
    </div>);
}
// ── Main Component ────────────────────────────────────────────────────────────
function AgentDetailView(_a) {
    var agent = _a.agent, onClose = _a.onClose;
    var _b = (0, react_1.useState)('dashboard'), activeTab = _b[0], setActiveTab = _b[1];
    var _c = (0, react_1.useState)(false), isEditing = _c[0], setIsEditing = _c[1];
    // Reset edit mode on tab switch
    (0, react_1.useEffect)(function () {
        setIsEditing(false);
    }, [activeTab]);
    function handleAssignTask() {
        fetch('/api/issues', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Task for ' + agent.name,
                assignee: agent.id,
                project: 'Mission Control',
                type: 'task',
                priority: 'medium',
                status: 'backlog',
                acceptance_criteria: 'Define acceptance criteria',
            }),
        })
            .then(function (r) {
            if (!r.ok)
                throw new Error('Failed');
            alert('Task assigned to ' + agent.name);
        })
            .catch(function () { return alert('Failed to create task'); });
    }
    function handleRunHeartbeat() {
        fetch("/api/agents/".concat(agent.id, "/heartbeat"), { method: 'POST' })
            .then(function () { return alert('Heartbeat triggered'); })
            .catch(function () { return alert('Failed to trigger heartbeat'); });
    }
    return (<div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70" onClick={onClose}>
      <div className="w-full max-w-xl md:rounded-2xl rounded-t-2xl border border-white/10 bg-[#080808] flex flex-col max-h-[92vh] md:max-h-[85vh]" onClick={function (e) { return e.stopPropagation(); }}>
        {/* Header */}
        <div className="flex items-center gap-4 px-5 pt-5 pb-4 border-b border-white/10 shrink-0">
          <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center text-2xl md:text-3xl shrink-0" style={{ background: agent.color + '18', border: '1px solid ' + agent.color + '30' }}>
            {agent.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-white font-semibold text-base">{agent.name}</p>
              <mc_atoms_1.Dot status={agent.status}/>
              {agent.status === 'planned' && (<span className="text-[9px] px-1.5 py-0.5 rounded-full border border-white/10 text-white/50 bg-[#0f0f0f] font-semibold uppercase">Planned</span>)}
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/50">{agent.modelShort}</span>
            </div>
            <p className="text-white/50 text-xs">{agent.role}</p>
          </div>
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <ui_1.Button variant="secondary" size="sm" onClick={handleAssignTask}>
              <lucide_react_1.Plus size={12} className="mr-1"/> Assign Task
            </ui_1.Button>
            <ui_1.Button variant="secondary" size="sm" onClick={handleRunHeartbeat}>
              <lucide_react_1.Heart size={12} className="mr-1"/> Run Heartbeat
            </ui_1.Button>
            <ui_1.Button variant="ghost" size="sm" disabled>
              <lucide_react_1.Pause size={12} className="mr-1"/> Pause
            </ui_1.Button>
            <ui_1.Button variant="icon" onClick={onClose}>
              <lucide_react_1.X size={16}/>
            </ui_1.Button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 px-4 pt-3 pb-1 border-b border-white/10 overflow-x-auto shrink-0 no-scrollbar">
          {TABS.map(function (tab) {
            var Icon = tab.icon;
            var isActive = activeTab === tab.id;
            return (<button key={tab.id} onClick={function () { return setActiveTab(tab.id); }} className={"flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs whitespace-nowrap transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-white/30 ".concat(isActive
                    ? 'bg-white/10 text-white'
                    : 'text-white/40 hover:text-white/60 hover:bg-white/5')}>
                <Icon size={12}/>
                {tab.label}
              </button>);
        })}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'dashboard' && <DashboardTab agent={agent}/>}
          {activeTab === 'instructions' && <InstructionsTab agent={agent}/>}
          {activeTab === 'skills' && <SkillsTab agent={agent}/>}
          {activeTab === 'configuration' && <ConfigurationTab agent={agent}/>}
          {activeTab === 'runs' && <RunsTab agent={agent}/>}
          {activeTab === 'budget' && <BudgetTab agent={agent}/>}
        </div>
      </div>
    </div>);
}
