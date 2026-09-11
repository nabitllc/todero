import type { GoalLevel, GoalStatus } from "../constants.js";

export interface Goal {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  level: GoalLevel;
  status: GoalStatus;
  parentId: string | null;
  ownerAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A goal as the Goals list returns it: the goal plus how much of the work under
 * it is finished. `taskCount` leaves cancelled tasks out — they are work that
 * was called off, not work still owed — so `doneTaskCount === taskCount` is
 * what "everything under this goal is done" means.
 */
export interface GoalWithTaskCounts extends Goal {
  taskCount: number;
  doneTaskCount: number;
}
