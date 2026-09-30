"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { TaskColumn } from "@/components/tasks/TaskColumn";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { EditTaskDialog } from "@/components/tasks/EditTaskDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { LootRevealDialog } from "@/components/loot/LootRevealDialog";
import { useToast } from "@/components/ui/toast";
import {
  completeDuelTaskAction,
  completeTaskAction,
  deleteTaskAction,
  markLootRevealedAction,
  updateTaskStatusAction,
} from "@/lib/actions/tasks";
import type { TaskActions } from "@/components/tasks/taskActions";
import type { ClaimLootResult, Profile, Task, TaskType } from "@/types/database";
import type { DuelCardInfo } from "@/lib/data/duels";

export function KanbanBoard({
  guildId,
  tasks,
  members,
  currentUserId,
  duelInfo = {},
  isLeader = false,
  pendingLoot = [],
}: {
  guildId: string;
  tasks: Task[];
  members: Profile[];
  currentUserId: string;
  duelInfo?: Record<string, DuelCardInfo>;
  isLeader?: boolean;
  /** Rewards already applied but whose reveal the player hasn't seen yet. */
  pendingLoot?: ClaimLootResult[];
}) {
  const { toast } = useToast();
  const [lootQueue, setLootQueue] = useState<ClaimLootResult[]>(pendingLoot);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const assigneeNames = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m.display_name])), [members]);

  const complete = useCallback(
    async (taskId: string, taskType: TaskType) => {
      if (taskType === "duel") {
        const result = await completeDuelTaskAction(taskId);
        // Success is announced by the persistent "You won the duel!" notification.
        if (result.error) toast({ title: "Couldn't complete the duel", description: result.error, variant: "error" });
        return;
      }
      const result = await completeTaskAction(taskId);
      if (result.error) {
        toast({ title: "Couldn't complete the task", description: result.error, variant: "error" });
        return;
      }
      const data = result.data;
      if (!data) return;
      if (data.loot) {
        const loot = data.loot;
        setLootQueue((q) => (q.some((l) => l.task_id === loot.task_id) ? q : [...q, loot]));
      }
      if (data.boss_defeated) {
        toast({ title: "Boss defeated!", description: `Your final strike dealt ${data.damage} damage.`, variant: "success", duration: 6000 });
      } else {
        const bonus = data.xp_multiplier && data.xp_multiplier > 1 ? ` · ${data.xp_multiplier}× XP` : "";
        toast({ title: `${data.damage} damage dealt`, description: `+${data.xp_awarded ?? data.damage} XP${bonus}`, variant: "success" });
      }
    },
    [toast]
  );

  const move = useCallback(
    async (taskId: string, status: "todo" | "doing") => {
      const result = await updateTaskStatusAction(taskId, status);
      if (result.error) toast({ title: "Couldn't move the task", description: result.error, variant: "error" });
    },
    [toast]
  );

  const actions: TaskActions = useMemo(
    () => ({ complete, move, edit: setEditing, remove: setDeleting }),
    [complete, move]
  );

  function confirmDelete() {
    const task = deleting;
    if (!task) return;
    startDelete(async () => {
      const result = await deleteTaskAction(task.id);
      if (result.error) toast({ title: "Couldn't delete the task", description: result.error, variant: "error" });
      else toast({ title: "Task deleted", variant: "info" });
      setDeleting(null);
    });
  }

  function closeLoot() {
    const current = lootQueue[0];
    if (current) void markLootRevealedAction(current.task_id);
    setLootQueue((q) => q.slice(1));
  }

  const todo = tasks.filter((t) => t.status === "todo");
  const doing = tasks.filter((t) => t.status === "doing");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <section aria-label="Task board" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-parchment-dim">Battlefield</h2>
        <TaskFormDialog guildId={guildId} members={members} currentUserId={currentUserId} />
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-surface-border p-8 text-center">
          <p className="font-display text-sm font-semibold text-parchment">The battlefield is empty.</p>
          <p className="mt-1 text-xs text-parchment-dim">Create your first task to start dealing damage.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TaskColumn status="todo" label="To Do" tasks={todo} assigneeNames={assigneeNames} duelInfo={duelInfo} currentUserId={currentUserId} isLeader={isLeader} actions={actions} emptyHint="Nothing queued." />
          <TaskColumn status="doing" label="Doing" tasks={doing} assigneeNames={assigneeNames} duelInfo={duelInfo} currentUserId={currentUserId} isLeader={isLeader} actions={actions} emptyHint="Drag a task here." />
          <TaskColumn status="done" label="Done" tasks={done} assigneeNames={assigneeNames} duelInfo={duelInfo} currentUserId={currentUserId} isLeader={isLeader} actions={actions} emptyHint="No hits landed yet." />
        </div>
      )}

      <EditTaskDialog task={editing} members={members} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title="Delete this task?"
        description={deleting ? `"${deleting.title}" will be removed for everyone in the guild.` : ""}
        confirmLabel="Delete task"
        destructive
        pending={isDeleting}
        onConfirm={confirmDelete}
      />
      <LootRevealDialog loot={lootQueue[0] ?? null} onClose={closeLoot} />
    </section>
  );
}
