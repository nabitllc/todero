/**
 * The Plan tab: the goal, the features with what done looks like, and the
 * tasks. While the plan is still waiting for a yes it is also the approval
 * card — untick anything you do not want and approve the rest. Once approved
 * it stays here as the record of what was agreed.
 */
import type { ToderoPlan } from "@todero/shared";
import { planApproveLabel } from "./turn-sentence";
import { planTaskStatusLabel } from "./work-item-plan";
import type { WorkItemTaskRow } from "./work-item-model";

export type WorkItemPlanTabProps = {
  plan: ToderoPlan;
  /** True while the plan is still waiting: the tick boxes and buttons show. */
  approvable?: boolean;
  /** The real tasks the plan made, so each line can say where it stands. */
  tasks?: WorkItemTaskRow[];
  /** Which tasks are still ticked. Owned above so the turn bar agrees with it. */
  kept?: Set<string>;
  onToggleTask?: (taskId: string) => void;
  onApprove?: () => void;
  onAskForChanges?: () => void;
};

export function WorkItemPlanTab(props: WorkItemPlanTabProps) {
  const { plan, approvable = false, tasks, kept, onToggleTask, onApprove, onAskForChanges } = props;
  const keptCount = approvable && kept ? plan.tasks.filter((task) => kept.has(task.id)).length : plan.tasks.length;

  return (
    <section className="work-item-plan-card" data-testid="work-item-plan-card">
      <div className="work-item-plan-card-head">
        <span className="work-item-plan-card-label">{approvable ? "Proposed plan" : "Plan"}</span>
        <p className="work-item-plan-goal">
          <span className="work-item-plan-goal-label">Goal</span> {plan.goal}
        </p>
      </div>

      {plan.features.length > 0 ? (
        <ul className="work-item-plan-features">
          {plan.features.map((feature) => (
            <li key={feature.id} className="work-item-plan-feature">
              <span className="work-item-plan-feature-name">{feature.name}</span>
              {feature.doneWhen ? (
                <span className="work-item-plan-feature-done"> · done when {feature.doneWhen}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="work-item-plan-tasks">
        {plan.tasks.map((task) => {
          const ticked = !kept || kept.has(task.id);
          // Where the task this line became stands today. Nothing to say while
          // the plan is still a proposal — it has made no tasks yet.
          const statusLabel = planTaskStatusLabel(task, tasks);
          return (
            <li key={task.id} className="work-item-plan-task">
              <label className="work-item-plan-task-label">
                {approvable ? (
                  <input
                    type="checkbox"
                    className="work-item-plan-task-check"
                    data-testid="work-item-plan-task-check"
                    data-task-id={task.id}
                    checked={ticked}
                    onChange={() => onToggleTask?.(task.id)}
                  />
                ) : null}
                <span
                  className={
                    ticked ? "work-item-plan-task-title" : "work-item-plan-task-title work-item-plan-task-dropped"
                  }
                >
                  {task.title}
                </span>
                {task.feature ? <span className="work-item-plan-task-feature">{task.feature}</span> : null}
                {statusLabel ? (
                  <span className="work-item-plan-task-status" data-testid="work-item-plan-task-status">
                    {statusLabel}
                  </span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>

      {approvable ? (
        <div className="work-item-plan-actions">
          <button
            type="button"
            className="work-item-plan-approve"
            data-testid="work-item-plan-approve"
            disabled={keptCount === 0}
            onClick={() => onApprove?.()}
          >
            {planApproveLabel(keptCount, plan.tasks.length)}
          </button>
          <button
            type="button"
            className="work-item-plan-changes"
            data-testid="work-item-plan-changes"
            onClick={() => onAskForChanges?.()}
          >
            Ask for changes
          </button>
        </div>
      ) : null}
    </section>
  );
}
