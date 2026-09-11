import type { Goal, GoalWithTaskCounts } from "@todero/shared";
import { api } from "./client";

export const goalsApi = {
  // The list carries the task counts the Goals page shows; every other caller
  // can keep treating the rows as plain goals.
  list: (companyId: string) => api.get<GoalWithTaskCounts[]>(`/companies/${companyId}/goals`),
  get: (id: string) => api.get<Goal>(`/goals/${id}`),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Goal>(`/companies/${companyId}/goals`, data),
  update: (id: string, data: Record<string, unknown>) => api.patch<Goal>(`/goals/${id}`, data),
  remove: (id: string) => api.delete<Goal>(`/goals/${id}`),
};
