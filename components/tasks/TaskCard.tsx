"use client";

import { useTransition } from "react";
import { Bomb, Swords, Gift, ChevronLeft, ChevronRight, Check, Trash2, Pencil, AlarmClock } from "lucide-react";
import { cn, formatCountdown } from "@/lib/utils";
import { GAME_CONFIG } from "@/config/gameConfig";
import { Button } from "@/components/ui/button";
import { useServerNow } from "@/lib/hooks/useServerClock";
import type { TaskActions } from "@/components/tasks/taskActions";
import type { Duel, Task } from "@/types/database";

const DIFFICULTY_DOT: Record<Task["difficulty"], string> = {
  low: "bg-parchment-faint",
  medium: "bg-gold",
  high: "bg-crimson-bright",
};

function TypeBadge({ type }: { type: Task["task_type"] }) {
  if (type === "bomb") return <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-semibold text-danger"><Bomb className="h-3 w-3" /> Bomb</span>;
  if (type === "duel") return <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold text-gold"><Swords className="h-3 w-3" /> Duel</span>;
  if (type === "loot") return <span className="inline-flex items-center gap-1 rounded-full bg-crimson/15 px-2 py-0.5 text-[10px] font-semibold text-crimson-bright"><Gift className="h-3 w-3" /> Loot</span>;
  return null;
}

export function TaskCard({
  task,
  assigneeName,
  opponentName,
  duelStatus,
  currentUserId,
  isLeader = false,
  draggable,
  onDragStart,
  actions,
}: {
  task: Task;
  assigneeName: string | null;
  opponentName?: string | null;
  duelStatus?: Duel["status"];
  currentUserId: string;
  /** Guild leaders may edit / move / delete any open ordinary task (enforced by RLS). */
  isLeader?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  actions: TaskActions;
}) {
  const [isPending, startTransition] = useTransition();

  const isBomb = task.task_type === "bomb";
  const isDuel = task.task_type === "duel";
  const isDone = task.status === "done";
  const ticking = isBomb && !task.bomb_result && !isDone;

  // Countdowns run on the SERVER clock (offset-corrected), not the visitor's.
  // Display only — the database decides when a bomb explodes or a task is overdue.
  const now = useServerNow(ticking ? 1000 : 30_000);
  const bombMs = isBomb && task.bomb_expires_at ? new Date(task.bomb_expires_at).getTime() - now : null;
  const isOverdue =
    !isDone && !isBomb && !isDuel && (!!task.penalized_at || (!!task.due_date && new Date(task.due_date).getTime() <= now));

  const isDuelLoss = isDuel && isDone && !task.completed_by && duelStatus !== "expired";
  const isDuelExpired = isDuel && isDone && !task.completed_by && duelStatus === "expired";
  const isDuelWin = isDuel && isDone && !!task.completed_by;
  const duelReward = task.damage * GAME_CONFIG.duel.rewardMultiplier;

  // These mirror the server rules exactly; the server re-checks every one.
  //  complete: the assignee, or anyone when the task is unassigned (complete_task)
  //  edit/move: creator, assignee, leader, or anyone on an unassigned task (RLS)
  //  delete: creator or leader, ordinary tasks only (RLS)
  const canComplete = !isDone && (!task.assigned_to || task.assigned_to === currentUserId);
  const canManage =
    !isDone && (task.creator_id === currentUserId || task.assigned_to === currentUserId || !task.assigned_to || isLeader);
  const ordinary = task.task_type === "normal" || task.task_type === "loot";
  const canEdit = canManage && ordinary;
  const canMove = canManage;
  const canDelete = !isDone && ordinary && (task.creator_id === currentUserId || isLeader);

  function run(action: () => Promise<void>) {
    startTransition(async () => {
      await action();
    });
  }

  function handleMove(direction: "back" | "forward") {
    if (direction === "forward" && task.status === "doing") {
      run(() => actions.complete(task.id, task.task_type));
      return;
    }
    const next = direction === "forward" ? "doing" : "todo";
    run(() => actions.move(task.id, next));
  }

  return (
    <div
      draggable={draggable && !isDone && canManage}
      onDragStart={onDragStart}
      className={cn(
        "group flex flex-col gap-2 rounded-md border border-surface-border bg-surface-raised p-3 text-left shadow-card transition-opacity",
        isDone && "opacity-60",
        isOverdue && "border-danger/50",
        draggable && !isDone && canManage && "cursor-grab active:cursor-grabbing"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", DIFFICULTY_DOT[task.difficulty])} aria-hidden />
          <p className={cn("break-words text-sm font-semibold text-parchment", isDone && "line-through decoration-parchment-faint")}>
            {task.title}
          </p>
        </div>
        {!isDone && !isDuel && (
          <span className="shrink-0 text-stat text-xs font-semibold text-crimson-bright">{task.damage} dmg</span>
        )}
        {!isDone && isDuel && (
          <span className="shrink-0 text-stat text-xs font-semibold text-gold">{duelReward} XP</span>
        )}
      </div>

      {task.description && <p className="break-words text-xs text-parchment-dim">{task.description}</p>}

      <div className="flex flex-wrap items-center gap-1.5">
        <TypeBadge type={task.task_type} />
        {assigneeName && (
          <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium text-parchment-dim">{assigneeName}</span>
        )}
        {isDuel && opponentName && (
          <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[10px] font-medium text-gold">vs {opponentName}</span>
        )}
        {task.due_date && !isDone && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium",
              isOverdue ? "text-danger" : "text-parchment-dim"
            )}
          >
            {isOverdue && <AlarmClock className="h-3 w-3" aria-hidden />}
            {isOverdue ? "Overdue · " : "Due "}
            <time dateTime={task.due_date} suppressHydrationWarning>
              {new Date(task.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </time>
          </span>
        )}
      </div>

      {ticking && bombMs !== null && (
        <p className={cn("text-stat text-xs font-bold", bombMs < 60_000 ? "text-danger" : "text-parchment-dim")}>
          <span aria-hidden>💣 </span>
          <span suppressHydrationWarning>{bombMs > 0 ? formatCountdown(bombMs) : "resolving…"}</span>
        </p>
      )}
      {task.bomb_result === "exploded" && <p className="text-xs font-semibold text-danger">💥 Exploded</p>}
      {task.bomb_result === "defused" && <p className="text-xs font-semibold text-gold">💥 Defused</p>}
      {isDuelWin && <p className="text-xs font-semibold text-gold">🏆 Duel won — +{duelReward} XP</p>}
      {isDuelLoss && <p className="text-xs font-semibold text-parchment-faint">Duel lost — no reward</p>}
      {isDuelExpired && <p className="text-xs font-semibold text-parchment-faint">Duel ended with no winner</p>}

      {!isDone && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {canMove && task.status === "doing" && (
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => handleMove("back")} disabled={isPending} aria-label="Move to To Do">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          {canMove && task.status === "todo" && (
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => handleMove("forward")} disabled={isPending} aria-label="Move to Doing">
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
          {canComplete && (
            <Button size="sm" variant="primary" className="h-8 px-2" onClick={() => run(() => actions.complete(task.id, task.task_type))} disabled={isPending}>
              <Check className="h-3.5 w-3.5" /> {isPending ? "Striking…" : "Complete"}
            </Button>
          )}
          <div className="flex-1" />
          {canEdit && (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-parchment-faint" onClick={() => actions.edit(task)} disabled={isPending} aria-label={`Edit ${task.title}`}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {canDelete && (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-parchment-faint" onClick={() => actions.remove(task)} disabled={isPending} aria-label={`Delete ${task.title}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
