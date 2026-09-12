import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import type { Issue } from "@todero/shared";
import { useCompany } from "../context/CompanyContext";
import { useToastActions } from "../context/ToastContext";
import { issuesApi } from "../api/issues";
import { goalsApi } from "../api/goals";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { collectLiveIssueIds } from "../lib/liveIssueIds";
import { ToderoLoading } from "../components/AnimatedToderoIcon";
import { useIsPhoneWidth } from "../hooks/useIsPhoneWidth";
import {
  BOARD_COLUMNS,
  BOARD_PHONE_COLUMN_ORDER,
  type BoardColumn,
} from "../lib/board-model";
import { boardViewFor, openChildCounts, ownersForColumn } from "../lib/board-view";
import { BOARD_PREFS_DEFAULT, loadBoardPrefs, saveBoardPrefs, type BoardPrefs } from "../lib/board-prefs";
import { BoardColumnHeaders } from "../components/board/BoardColumnHeaders";
import { BoardLane, parseLaneDropId } from "../components/board/BoardLane";
import { BoardCard } from "../components/board/BoardCard";
import { BoardToolbar } from "../components/board/BoardToolbar";
import { useBoardDrop } from "../components/board/BoardDragHandlers";
import { BoardConfirm, type BoardConfirmRequest } from "../components/board/BoardConfirm";

export function Board() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  if (!selectedCompanyId) return <ToderoLoading />;
  // Pause is the organization's own switch: nothing new starts while it is on,
  // so the board stands that work in Queued and says why.
  return <BoardContent companyId={selectedCompanyId} paused={selectedCompany?.status === "paused"} />;
}

function BoardContent({ companyId, paused }: { companyId: string; paused: boolean }) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const isPhone = useIsPhoneWidth();

  const [prefs, setPrefs] = useState<BoardPrefs>(BOARD_PREFS_DEFAULT);
  const [collapsedRows, setCollapsedRows] = useState<Record<string, boolean>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<BoardConfirmRequest | null>(null);

  useEffect(() => {
    setPrefs(loadBoardPrefs(companyId));
    setCollapsedRows({});
  }, [companyId]);

  const updatePrefs = useCallback(
    (patch: Partial<BoardPrefs>) => {
      setPrefs((previous) => {
        const next = { ...previous, ...patch };
        saveBoardPrefs(companyId, next);
        return next;
      });
    },
    [companyId],
  );

  const issuesQuery = useQuery({
    queryKey: queryKeys.issues.list(companyId),
    queryFn: () => issuesApi.list(companyId),
  });
  const goalsQuery = useQuery({
    queryKey: queryKeys.goals.list(companyId),
    queryFn: () => goalsApi.list(companyId),
  });
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
  });
  const liveRunsQuery = useQuery({
    queryKey: queryKeys.liveRuns(companyId),
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId),
  });

  const issues: Issue[] = useMemo(() => issuesQuery.data ?? [], [issuesQuery.data]);
  const goals = useMemo(() => goalsQuery.data ?? [], [goalsQuery.data]);
  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);

  const liveIssueIds = useMemo(
    () => collectLiveIssueIds(liveRunsQuery.data ?? [], issues),
    [liveRunsQuery.data, issues],
  );

  const view = useMemo(
    () =>
      boardViewFor({
        issues,
        goals,
        agents,
        liveIssueIds,
        groupBy: prefs.rowsBy,
        agentFilter: prefs.agentFilter,
        organizationPaused: paused,
      }),
    [issues, goals, agents, liveIssueIds, prefs.rowsBy, prefs.agentFilter, paused],
  );

  const rows = useMemo(
    () => (prefs.showCompleted ? view.rows : view.rows.filter((row) => !row.collapsedByDefault || row.totalCount > row.doneCount)),
    [view.rows, prefs.showCompleted],
  );

  const columns: readonly BoardColumn[] = isPhone ? BOARD_PHONE_COLUMN_ORDER : BOARD_COLUMNS;
  const owners = useMemo(
    () => ({
      working: ownersForColumn("working", view, agents),
      review: ownersForColumn("review", view, agents),
    }),
    [view, agents],
  );

  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const childCounts = useMemo(() => openChildCounts(issues), [issues]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(companyId) });
  }, [queryClient, companyId]);

  const { handleDrop } = useBoardDrop({
    tasks: issues,
    agentsById,
    openChildCountById: childCounts,
    organizationPaused: paused,
    onConfirm: (message, onYes) => setConfirmRequest({ message, onYes }),
    onRefuse: (reason) => pushToast({ title: "Not from here", body: reason, tone: "warn" }),
    onDone: (message) => pushToast({ title: message, tone: "success" }),
    onFail: (message) => pushToast({ title: "That did not work", body: message, tone: "error" }),
    onRefresh: refresh,
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragStart = useCallback((event: DragStartEvent) => setDraggingId(String(event.active.id)), []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingId(null);
      const overId = event.over?.id;
      if (!overId) return;
      const card = view.byId.get(String(event.active.id));
      if (!card) return;
      const overCard = view.byId.get(String(overId));
      const target = parseLaneDropId(String(overId)) ?? (overCard ? { rowId: overCard.rowId, column: overCard.column } : null);
      if (!target) return;
      // Inside one column the slot matters: the card it was dropped over, or
      // the bottom of the lane when it was dropped on the lane itself.
      const lane = view.cards.get(target.rowId)?.[target.column] ?? [];
      const position =
        card.column === target.column && card.rowId === target.rowId
          ? {
              column: lane.map((entry) => ({ id: entry.id, priority: entry.priority })),
              toIndex: overCard ? lane.findIndex((entry) => entry.id === overCard.id) : lane.length - 1,
            }
          : undefined;
      handleDrop(card.id, card.column, target.column, position);
    },
    [view.byId, handleDrop],
  );

  const loading = issuesQuery.isLoading || goalsQuery.isLoading || agentsQuery.isLoading;
  const failed = issuesQuery.isError || goalsQuery.isError || agentsQuery.isError;

  if (loading) return <ToderoLoading />;

  if (failed) {
    return (
      <div className="p-4">
        <p className="text-(length:--text-compact) text-destructive">
          The board could not be loaded. Reload the page, or open Tasks instead.
        </p>
      </div>
    );
  }

  const draggingCard = draggingId ? view.byId.get(draggingId) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-(length:--text-section) font-semibold text-foreground">Board</h1>
        <BoardToolbar prefs={prefs} agents={agents} onChange={updatePrefs} />
      </header>

      {paused ? (
        <p className="text-(length:--text-compact) text-muted-foreground" data-testid="board-paused-note">
          This organization is paused, so nothing talks to a model until you press Play. Work already under way finishes.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-(length:--text-compact) text-muted-foreground">
          Nothing on the board yet. Give the organization a plan and the features appear here as rows.
        </p>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="flex min-w-max snap-x flex-col gap-3 pb-4">
              <BoardColumnHeaders columns={columns} counts={view.totalByColumn} wip={view.wip} owners={owners} />
              {rows.map((row) => (
                <BoardLane
                  key={row.id}
                  row={row}
                  columns={columns}
                  cards={view.cards.get(row.id) ?? { queued: [], working: [], review: [], "your-turn": [], done: [] }}
                  collapsed={collapsedRows[row.id] ?? row.collapsedByDefault}
                  compact={prefs.compactCards}
                  dragEnabled={!isPhone}
                  onCardAction={isPhone ? handleDrop : undefined}
                  onToggle={() =>
                    setCollapsedRows((previous) => ({
                      ...previous,
                      [row.id]: !(previous[row.id] ?? row.collapsedByDefault),
                    }))
                  }
                />
              ))}
            </div>
          </div>
          <DragOverlay>{draggingCard ? <BoardCard card={draggingCard} compact={prefs.compactCards} overlay /> : null}</DragOverlay>
        </DndContext>
      )}

      <BoardConfirm request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  );
}

export default Board;
