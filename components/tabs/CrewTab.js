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
exports.default = CrewTab;
// TOD-906: Crew tab — workspace members and role management
// Owners can assign/change roles for any human member or agent.
// Members and Viewers see read-only list.
var react_1 = require("react");
var lucide_react_1 = require("lucide-react");
var AgentsTab_1 = require("@/components/tabs/AgentsTab");
var MemberDetailView_1 = require("@/components/tabs/MemberDetailView");
// ── Role badges ───────────────────────────────────────────────────────────────
var ROLE_BADGE = {
    owner: { label: 'Owner', className: 'bg-amber-500/20 text-amber-300 border border-amber-500/30' },
    member: { label: 'Member', className: 'bg-blue-500/20 text-blue-300 border border-blue-500/30' },
    viewer: { label: 'Viewer', className: 'bg-white/10 text-white/50 border border-white/10' },
};
var ROLE_DESCRIPTIONS = {
    owner: 'Full access including role management and workspace settings',
    member: 'Full board and issue access; cannot manage roles or workspace settings',
    viewer: 'Read-only access to board and issues; cannot create, edit, or transition',
};
function RoleBadge(_a) {
    var _b;
    var role = _a.role;
    var cfg = (_b = ROLE_BADGE[role]) !== null && _b !== void 0 ? _b : { label: role, className: 'bg-white/10 text-white/50' };
    return (<span className={"px-2 py-0.5 rounded text-[11px] font-medium ".concat(cfg.className)}>
      {cfg.label}
    </span>);
}
// ── AddMemberModal ────────────────────────────────────────────────────────────
function AddMemberModal(_a) {
    var onClose = _a.onClose, onAdded = _a.onAdded;
    var _b = (0, react_1.useState)(''), identity = _b[0], setIdentity = _b[1];
    var _c = (0, react_1.useState)('member'), role = _c[0], setRole = _c[1];
    var _d = (0, react_1.useState)(false), saving = _d[0], setSaving = _d[1];
    var _e = (0, react_1.useState)(null), error = _e[0], setError = _e[1];
    function submit(e) {
        return __awaiter(this, void 0, void 0, function () {
            var res, json, err_1;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        e.preventDefault();
                        if (!identity.trim())
                            return [2 /*return*/];
                        setSaving(true);
                        setError(null);
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 4, 5, 6]);
                        return [4 /*yield*/, fetch('/api/roles', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ identity: identity.trim(), role: role }),
                            })];
                    case 2:
                        res = _b.sent();
                        return [4 /*yield*/, res.json()];
                    case 3:
                        json = _b.sent();
                        if (!res.ok)
                            throw new Error((_a = json.error) !== null && _a !== void 0 ? _a : 'Failed to add member');
                        onAdded();
                        onClose();
                        return [3 /*break*/, 6];
                    case 4:
                        err_1 = _b.sent();
                        setError(err_1 instanceof Error ? err_1.message : String(err_1));
                        return [3 /*break*/, 6];
                    case 5:
                        setSaving(false);
                        return [7 /*endfinally*/];
                    case 6: return [2 /*return*/];
                }
            });
        });
    }
    return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a2e] border border-white/10 rounded-xl p-6 w-full max-w-sm shadow-xl">
        <h3 className="text-white font-semibold text-sm mb-4">Add Workspace Member</h3>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-white/50 text-xs block mb-1">Identity (username, email, or agent ID)</label>
            <input autoFocus value={identity} onChange={function (e) { return setIdentity(e.target.value); }} placeholder="e.g. michael, builder, alice@acme.com" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-white/30"/>
          </div>
          <div>
            <label className="text-white/50 text-xs block mb-1">Role</label>
            <select value={role} onChange={function (e) { return setRole(e.target.value); }} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-white/30">
              <option value="owner">Owner — full access + role management</option>
              <option value="member">Member — full board/issue access</option>
              <option value="viewer">Viewer — read-only</option>
            </select>
          </div>
          {error && (<div className="flex items-center gap-2 text-red-400 text-xs">
              <lucide_react_1.AlertCircle size={12}/>
              {error}
            </div>)}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg bg-white/5 text-white/50 text-sm hover:bg-white/10 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !identity.trim()} className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50 transition-colors">
              {saving ? 'Adding…' : 'Add Member'}
            </button>
          </div>
        </form>
      </div>
    </div>);
}
// ── MemberRow ─────────────────────────────────────────────────────────────────
function MemberRow(_a) {
    var onSelect = _a.onSelect, member = _a.member, isOwner = _a.isOwner, currentIdentity = _a.currentIdentity, onRoleChange = _a.onRoleChange, onRemove = _a.onRemove;
    var _b = (0, react_1.useState)(false), changing = _b[0], setChanging = _b[1];
    function handleRoleChange(newRole) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (newRole === member.role)
                            return [2 /*return*/];
                        setChanging(true);
                        return [4 /*yield*/, onRoleChange(member.id, newRole)];
                    case 1:
                        _a.sent();
                        setChanging(false);
                        return [2 /*return*/];
                }
            });
        });
    }
    var isMe = currentIdentity !== null && currentIdentity === member.identity;
    return (<div className="flex items-center gap-3 py-3 border-b border-white/5 last:border-0">
      <div className={"w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60 text-xs font-medium flex-shrink-0".concat(isMe ? ' ring-2 ring-blue-500/60' : '')}>
        {member.identity.charAt(0).toUpperCase()}
      </div>
      <button type="button" onClick={function () { return onSelect(member); }} className="flex-1 min-w-0 text-left rounded-md -mx-1 px-1 py-0.5 hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-white/50 transition-colors" aria-label={"Open details for ".concat(member.identity)}>
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-medium truncate">{member.identity}</span>
          {isMe && (<span className="bg-blue-500/30 text-blue-300 border border-blue-500/40 px-1.5 py-0.5 rounded text-[9px] font-semibold">You</span>)}
        </div>
        {member.assigned_by && (<span className="text-white/30 text-[10px]">assigned by {member.assigned_by}</span>)}
      </button>
      {isOwner ? (<select value={member.role} onChange={function (e) { return handleRoleChange(e.target.value); }} disabled={changing} className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-white/30 disabled:opacity-50">
          <option value="owner">Owner</option>
          <option value="member">Member</option>
          <option value="viewer">Viewer</option>
        </select>) : (<RoleBadge role={member.role}/>)}
      {isOwner && (<button onClick={function () { return onRemove(member.id, member.identity); }} className="text-white/20 hover:text-red-400 transition-colors p-1" title={"Remove ".concat(member.identity)}>
          <lucide_react_1.Trash2 size={13}/>
        </button>)}
    </div>);
}
// ── CrewTab ───────────────────────────────────────────────────────────────────
function CrewTab(_a) {
    var _this = this;
    var userRole = _a.userRole, currentIdentity = _a.currentIdentity, displayAgents = _a.displayAgents, agentLiveStatus = _a.agentLiveStatus, agentRunsData = _a.agentRunsData, liveAgents = _a.liveAgents, act = _a.act, agentModal = _a.agentModal, setAgentModal = _a.setAgentModal, projectFilter = _a.projectFilter;
    var isOwner = userRole === 'owner' || userRole === 'god' || userRole === 'admin';
    var _b = (0, react_1.useState)([]), members = _b[0], setMembers = _b[1];
    var _c = (0, react_1.useState)(false), loading = _c[0], setLoading = _c[1];
    var _d = (0, react_1.useState)(null), error = _d[0], setError = _d[1];
    var _e = (0, react_1.useState)(false), showAdd = _e[0], setShowAdd = _e[1];
    var _f = (0, react_1.useState)(null), selectedMember = _f[0], setSelectedMember = _f[1];
    var load = (0, react_1.useCallback)(function () { return __awaiter(_this, void 0, void 0, function () {
        var res, json, _a, err_2;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    setLoading(true);
                    setError(null);
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 6, 7, 8]);
                    return [4 /*yield*/, fetch('/api/roles')];
                case 2:
                    res = _c.sent();
                    if (!!res.ok) return [3 /*break*/, 4];
                    return [4 /*yield*/, res.json().catch(function () { return ({}); })];
                case 3:
                    json = _c.sent();
                    throw new Error((_b = json.error) !== null && _b !== void 0 ? _b : "HTTP ".concat(res.status));
                case 4:
                    _a = setMembers;
                    return [4 /*yield*/, res.json()];
                case 5:
                    _a.apply(void 0, [_c.sent()]);
                    return [3 /*break*/, 8];
                case 6:
                    err_2 = _c.sent();
                    setError(err_2 instanceof Error ? err_2.message : String(err_2));
                    return [3 /*break*/, 8];
                case 7:
                    setLoading(false);
                    return [7 /*endfinally*/];
                case 8: return [2 /*return*/];
            }
        });
    }); }, []);
    (0, react_1.useEffect)(function () { load(); }, [load]);
    function handleRoleChange(id, newRole) {
        return __awaiter(this, void 0, void 0, function () {
            var res, json, err_3;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 5, , 6]);
                        return [4 /*yield*/, fetch('/api/roles', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: id, role: newRole }),
                            })];
                    case 1:
                        res = _b.sent();
                        if (!!res.ok) return [3 /*break*/, 3];
                        return [4 /*yield*/, res.json().catch(function () { return ({}); })];
                    case 2:
                        json = _b.sent();
                        throw new Error((_a = json.error) !== null && _a !== void 0 ? _a : 'Failed to change role');
                    case 3: return [4 /*yield*/, load()];
                    case 4:
                        _b.sent();
                        return [3 /*break*/, 6];
                    case 5:
                        err_3 = _b.sent();
                        alert(err_3 instanceof Error ? err_3.message : String(err_3));
                        return [3 /*break*/, 6];
                    case 6: return [2 /*return*/];
                }
            });
        });
    }
    function handleRemove(id, identity) {
        return __awaiter(this, void 0, void 0, function () {
            var res, json, err_4;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!confirm("Remove ".concat(identity, " from workspace?")))
                            return [2 /*return*/];
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 6, , 7]);
                        return [4 /*yield*/, fetch("/api/roles?id=".concat(encodeURIComponent(id)), { method: 'DELETE' })];
                    case 2:
                        res = _b.sent();
                        if (!!res.ok) return [3 /*break*/, 4];
                        return [4 /*yield*/, res.json().catch(function () { return ({}); })];
                    case 3:
                        json = _b.sent();
                        throw new Error((_a = json.error) !== null && _a !== void 0 ? _a : 'Failed to remove member');
                    case 4: return [4 /*yield*/, load()];
                    case 5:
                        _b.sent();
                        return [3 /*break*/, 7];
                    case 6:
                        err_4 = _b.sent();
                        alert(err_4 instanceof Error ? err_4.message : String(err_4));
                        return [3 /*break*/, 7];
                    case 7: return [2 /*return*/];
                }
            });
        });
    }
    return (<div className="space-y-8">
      {/* ── Role reference ──────────────────────────────────────────────── */}
      <div>
        <h2 className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-3">
          Workspace Roles
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {['owner', 'member', 'viewer'].map(function (r) { return (<div key={r} className="bg-white/3 border border-white/8 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                {r === 'owner' && <lucide_react_1.ShieldCheck size={14} className="text-amber-400"/>}
                {r === 'member' && <lucide_react_1.UserCog size={14} className="text-blue-400"/>}
                {r === 'viewer' && <lucide_react_1.Eye size={14} className="text-white/40"/>}
                <RoleBadge role={r}/>
              </div>
              <p className="text-white/40 text-[11px] leading-relaxed">{ROLE_DESCRIPTIONS[r]}</p>
            </div>); })}
        </div>
      </div>

      {/* ── Workspace members ────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white/70 text-xs font-semibold uppercase tracking-wider">
            Workspace Members
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className="text-white/30 hover:text-white/60 transition-colors p-1" title="Refresh">
              <lucide_react_1.RefreshCw size={12} className={loading ? 'animate-spin' : ''}/>
            </button>
            {isOwner && (<button onClick={function () { return setShowAdd(true); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/80 text-white text-xs font-medium hover:bg-blue-600 transition-colors">
                <lucide_react_1.Plus size={12}/>
                Add Member
              </button>)}
          </div>
        </div>

        {error && (<div className="flex items-center gap-2 text-red-400 text-xs mb-3 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <lucide_react_1.AlertCircle size={12}/>
            {error}
          </div>)}

        {!error && members.length === 0 && !loading && (<div className="text-white/30 text-sm py-4 text-center">
            No members found. {isOwner ? 'Add the first member above.' : ''}
          </div>)}

        {members.length > 0 && (<div className="bg-white/3 border border-white/8 rounded-xl px-4">
            {__spreadArray([], members, true).sort(function (a, b) {
                var aIsMe = currentIdentity ? a.identity === currentIdentity : false;
                var bIsMe = currentIdentity ? b.identity === currentIdentity : false;
                if (aIsMe && !bIsMe)
                    return -1;
                if (!aIsMe && bIsMe)
                    return 1;
                return 0;
            }).map(function (m) { return (<MemberRow key={m.id} member={m} isOwner={isOwner} currentIdentity={currentIdentity} onRoleChange={handleRoleChange} onRemove={handleRemove} onSelect={setSelectedMember}/>); })}
          </div>)}
      </div>

      {/* ── Agent roster (existing AgentsTab) ───────────────────────────── */}
      <div>
        <h2 className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-3">
          <span className="flex items-center gap-2"><lucide_react_1.Users size={12}/>Agent Roster</span>
        </h2>
        <AgentsTab_1.default displayAgents={displayAgents} agentLiveStatus={agentLiveStatus} agentRunsData={agentRunsData} liveAgents={liveAgents} act={act} agentModal={agentModal} setAgentModal={setAgentModal} projectFilter={projectFilter}/>
      </div>

      {showAdd && (<AddMemberModal onClose={function () { return setShowAdd(false); }} onAdded={load}/>)}

      {selectedMember && (<MemberDetailView_1.default member={{
                id: selectedMember.id,
                name: selectedMember.identity,
                emoji: '👤',
                role: selectedMember.role,
                joinDate: selectedMember.assigned_by ? "assigned by ".concat(selectedMember.assigned_by) : '',
            }} onClose={function () { return setSelectedMember(null); }} onNavigateToIssue={function (issueId) {
                window.location.href = "/?issue=".concat(encodeURIComponent(issueId));
            }}/>)}
    </div>);
}
