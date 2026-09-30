import type { Task, TaskType } from "@/types/database";

/**
 * What a card / column can ask the board to do. The board owns the outcome
 * (toasts, loot reveal, confirm dialog) so that clicking a button and dragging
 * a card onto "Done" behave identically — previously the drag path discarded
 * the result, so errors were silent and loot was never revealed.
 */
export type TaskActions = {
  complete: (taskId: string, taskType: TaskType) => Promise<void>;
  move: (taskId: string, status: "todo" | "doing") => Promise<void>;
  edit: (task: Task) => void;
  remove: (task: Task) => void;
};
