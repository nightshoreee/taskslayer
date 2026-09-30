"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { TaskCard } from "@/components/tasks/TaskCard";
import type { TaskActions } from "@/components/tasks/taskActions";
import type { Task, TaskStatus, TaskType } from "@/types/database";
import type { DuelCardInfo } from "@/lib/data/duels";

export function TaskColumn({
  status,
  label,
  tasks,
  assigneeNames,
  duelInfo,
  currentUserId,
  isLeader = false,
  actions,
  emptyHint,
}: {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  assigneeNames: Record<string, string>;
  duelInfo: Record<string, DuelCardInfo>;
  currentUserId: string;
  isLeader?: boolean;
  actions: TaskActions;
  emptyHint: string;
}) {
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const taskId = e.dataTransfer.getData("text/task-id");
    const taskType = e.dataTransfer.getData("text/task-type") as TaskType;
    if (!taskId) return;
    // Same handler as the buttons: errors are toasted and loot is revealed.
    if (status === "done") void actions.complete(taskId, taskType);
    else void actions.move(taskId, status);
  }

  return (
    <div
      role="region"
      aria-label={`${label} column`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        "flex min-h-[160px] min-w-0 flex-col gap-2 rounded-lg border border-dashed border-surface-border/70 p-2 transition-colors",
        dragOver && "border-gold/60 bg-surface-raised/40"
      )}
    >
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-parchment-dim">{label}</h3>
        <span className="text-xs text-parchment-faint">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="rounded-md border border-surface-border/60 p-3 text-center text-xs text-parchment-faint">{emptyHint}</p>
      ) : (
        tasks.map((task) => {
          const duel = duelInfo[task.id];
          return (
            <TaskCard
              key={task.id}
              task={task}
              assigneeName={task.assigned_to ? (assigneeNames[task.assigned_to] ?? null) : null}
              opponentName={duel ? (assigneeNames[duel.opponentId] ?? null) : null}
              duelStatus={duel?.status}
              currentUserId={currentUserId}
              isLeader={isLeader}
              actions={actions}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/task-id", task.id);
                e.dataTransfer.setData("text/task-type", task.task_type);
              }}
            />
          );
        })
      )}
    </div>
  );
}
