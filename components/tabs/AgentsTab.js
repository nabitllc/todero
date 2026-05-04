'use client';
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AgentsTab;
var react_1 = require("react");
var mc_atoms_1 = require("@/lib/mc-atoms");
var ui_1 = require("@/components/ui");
var lucide_react_1 = require("lucide-react");
var AgentDetailView_1 = require("@/components/tabs/AgentDetailView");
function formatAgo(ms) {
    var sec = Math.floor(ms / 1000);
    if (sec < 60)
        return "".concat(sec, "s ago");
    var min = Math.floor(sec / 60);
    if (min < 60)
        return "".concat(min, "m ago");
    var h = Math.floor(min / 60);
    if (h < 24)
        return "".concat(h, "h ").concat(min % 60, "m ago");
    var d = Math.floor(h / 24);
    return "".concat(d, "d ").concat(h % 24, "h ago");
}
function lastActiveLabel(agentId, runsData) {
    var ar = runsData[agentId];
    if (!(ar === null || ar === void 0 ? void 0 : ar.startedAt))
        return 'never';
    var started = new Date(ar.startedAt).getTime();
    if (Number.isNaN(started))
        return 'unknown';
    var diff = Date.now() - started;
    if (ar.status === 'running' && diff < 30 * 60000)
        return 'active now';
    return formatAgo(diff);
}
function AgentsTab(_a) {
    var displayAgents = _a.displayAgents, agentLiveStatus = _a.agentLiveStatus, agentRunsData = _a.agentRunsData, liveAgents = _a.liveAgents, act = _a.act, agentModal = _a.agentModal, setAgentModal = _a.setAgentModal, projectFilter = _a.projectFilter;
    return (<div className="space-y-6">
              {liveAgents && <div className="flex items-center gap-2 mb-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pg"/><span className="text-white/30 text-[10px]">Live agent data · {displayAgents.length} agents</span></div>}
              {displayAgents.length === 0 && <ui_1.EmptyState icon={lucide_react_1.Users} title="No agents registered yet"/>}

              {/* Lead agent card */}
              {displayAgents.length > 0 && (function () {
            var _a;
            var ls0 = agentLiveStatus(displayAgents[0].id);
            var dotColor = ls0.dot === 'green' ? 'bg-emerald-500 dot-health-green' : ls0.dot === 'amber' ? 'bg-amber-500 dot-health-amber' : 'bg-white/10';
            return <div className="flex justify-center">
                <div className="rounded-2xl p-4 md:p-6 border border-white/10/50 card-glow w-full max-w-xs sm:max-w-sm cursor-pointer hover:border-white/20 transition-colors" style={{ background: '#0f0f0f' }} onClick={function () { return setAgentModal(displayAgents[0]); }}>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl" style={{ background: '#1a1a1a' }}>
                      {displayAgents[0].emoji}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-white font-semibold">{displayAgents[0].name}</p>
                        <span className={"inline-block w-2.5 h-2.5 rounded-full shrink-0 ".concat(dotColor)} title={ls0.label}/>
                        {displayAgents[0].modelShort && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/50">{displayAgents[0].modelShort}</span>}
                      </div>
                      <p className="text-white/50 text-xs">{displayAgents[0].role}</p>
                      {((_a = agentRunsData[displayAgents[0].id]) === null || _a === void 0 ? void 0 : _a.status) === 'running' && (<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-medium mt-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
                          On duty
                        </span>)}
                      {ls0.dot === 'green' && <p className="text-emerald-400/80 text-[10px] font-mono mt-0.5 truncate max-w-[200px]">↳ {ls0.label}</p>}
                      {ls0.dot === 'amber' && <p className="text-amber-400/70 text-[10px] font-mono mt-0.5">{ls0.label}</p>}
                      {ls0.dot === 'grey' && <p className="text-white/30 text-[10px] font-mono mt-0.5">Idle · last active {lastActiveLabel(displayAgents[0].id, agentRunsData)}</p>}
                    </div>
                  </div>
                  <p className="text-white/50 text-sm mb-4 leading-relaxed">{displayAgents[0].desc}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {displayAgents[0].capabilities.map(function (c) { return <mc_atoms_1.Chip key={c} label={c}/>; })}
                  </div>
                </div>
              </div>;
        })()}
              <div className="flex justify-center">
                <div className="w-px h-6 bg-gradient-to-b from-white/20 to-transparent"/>
              </div>
              <div className="flex justify-center">
                <div className="w-3/4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"/>
              </div>

              {/* Active agents */}
              <mc_atoms_1.SH icon="🤖">Active Agents</mc_atoms_1.SH>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayAgents.slice(1).filter(function (a) { return a.status !== 'planned'; }).sort(function (a, b) {
            var _a, _b;
            var la = agentLiveStatus(a.id).dot, lb = agentLiveStatus(b.id).dot;
            var pri = function (d) { return d === 'green' ? 0 : d === 'amber' ? 1 : 2; };
            if (pri(la) !== pri(lb))
                return pri(la) - pri(lb);
            return ((_a = a.ago) !== null && _a !== void 0 ? _a : 9999) - ((_b = b.ago) !== null && _b !== void 0 ? _b : 9999);
        }).map(function (a) {
            var _a, _b, _c;
            var ls = agentLiveStatus(a.id);
            var dotColor = ls.dot === 'green' ? 'bg-emerald-500 dot-health-green' : ls.dot === 'amber' ? 'bg-amber-500 dot-health-amber' : 'bg-white/10';
            return (<div key={a.id} className="rounded-2xl p-5 border card-glow cursor-pointer hover:border-white/20 transition-colors" style={{ background: '#0f0f0f', borderColor: a.color + '28' }} onClick={function () { return setAgentModal(a); }}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0" style={{ background: a.color + '18', border: '1px solid ' + a.color + '30' }}>
                        {a.emoji}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-white text-sm font-semibold truncate">{a.name}</p>
                          <span className={"inline-block w-2 h-2 rounded-full shrink-0 ".concat(dotColor)} title={ls.label}/>
                          {a.modelShort && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/50">{a.modelShort}</span>}
                        </div>
                        <p className="text-white/50 text-xs truncate">{a.role}</p>
                        {((_a = agentRunsData[a.id]) === null || _a === void 0 ? void 0 : _a.status) === 'running' && (<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-medium mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
                            On duty
                          </span>)}
                        <p className={"text-[10px] font-mono truncate ".concat(ls.dot === 'green' ? 'text-emerald-400/80' : ls.dot === 'amber' ? 'text-amber-400/70' : 'text-white/20')}>
                          {ls.dot === 'green' ? "\u21B3 ".concat(ls.label) : ls.label}
                        </p>
                        <p className="text-[9px] font-mono text-white/30 truncate" title="Time since last run">
                          last active {lastActiveLabel(a.id, agentRunsData)}
                        </p>
                      </div>
                    </div>
                    {ls.dot === 'green' && (a.currentTask || ((_b = agentRunsData[a.id]) === null || _b === void 0 ? void 0 : _b.taskTitle)) && <p className="text-emerald-400/60 text-[10px] mb-2 truncate">↳ {(a.currentTask || ((_c = agentRunsData[a.id]) === null || _c === void 0 ? void 0 : _c.taskTitle) || '').slice(0, 40)}</p>}
                    <p className="text-white/50 text-xs leading-relaxed mb-3">{a.desc}</p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {a.capabilities.map(function (c) { return <mc_atoms_1.Chip key={c} label={c}/>; })}
                    </div>
                  </div>);
        })}
              </div>

              {/* Planned agents */}
              {displayAgents.filter(function (a) { return a.status === 'planned'; }).length > 0 && (<>
                <mc_atoms_1.SH icon="📋">Planned Agents</mc_atoms_1.SH>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {displayAgents.filter(function (a) { return a.status === 'planned'; }).map(function (a) { return (<div key={a.id} className="rounded-2xl p-5 border border-dashed cursor-pointer hover:border-white/20 transition-colors opacity-60 hover:opacity-90" style={{ background: '#080808', borderColor: a.color + '20' }} onClick={function () { return setAgentModal(a); }}>
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0" style={{ background: a.color + '10', border: '1px dashed ' + a.color + '25' }}>
                          {a.emoji}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-white/40 text-sm font-semibold truncate">{a.name}</p>
                            <span className="text-[8px] px-1.5 py-0.5 rounded-full border border-white/10 text-white/50 bg-[#0f0f0f] font-semibold uppercase">Planned</span>
                            {a.modelShort && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/50">{a.modelShort}</span>}
                          </div>
                          <p className="text-white/30 text-xs truncate">{a.role}</p>
                        </div>
                      </div>
                      <p className="text-white/30 text-xs leading-relaxed mb-3">{a.desc}</p>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {a.capabilities.map(function (c) { return <mc_atoms_1.Chip key={c} label={c}/>; })}
                      </div>
                      {a.activatesWhen && (<div className="mt-2 pt-2 border-t border-white/10">
                          <span className="text-[9px] text-white/30">Activates: </span>
                          <span className="text-[9px] text-white/50">{a.activatesWhen}</span>
                        </div>)}
                    </div>); })}
                </div>
              </>)}


              {/* Agent Detail View */}
              {agentModal && (<AgentDetailView_1.default agent={agentModal} onClose={function () { return setAgentModal(null); }}/>)}
            </div>);
}
