"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus, Swords, Bomb, Gift, ListChecks } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { cn, endOfLocalDayIso, todayInputValue } from "@/lib/utils";
import { GAME_CONFIG } from "@/config/gameConfig";
import {
  createTaskAction,
  createBombTaskAction,
  createDuelTaskAction,
  createLootTaskAction,
} from "@/lib/actions/tasks";
import type { PriorityLevel, Profile } from "@/types/database";

type TaskTypeChoice = "normal" | "duel" | "bomb" | "loot";

const TYPE_OPTIONS: { value: TaskTypeChoice; label: string; icon: typeof Swords }[] = [
  { value: "normal", label: "Normal", icon: ListChecks },
  { value: "duel", label: "Duel", icon: Swords },
  { value: "bomb", label: "Bomb", icon: Bomb },
  { value: "loot", label: "Loot", icon: Gift },
];

const TITLE_PLACEHOLDER: Record<TaskTypeChoice, string> = {
  normal: "Finish DBMS PPT",
  duel: "Finish DBMS assignment",
  bomb: "Submit CAT 2 preparation",
  loot: "Refactor the auth module",
};

export function TaskFormDialog({
  guildId,
  members,
  currentUserId,
}: {
  guildId: string;
  members: Profile[];
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TaskTypeChoice>("normal");
  const [priority, setPriority] = useState<PriorityLevel>("medium");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const opponents = useMemo(() => members.filter((m) => m.id !== currentUserId), [members, currentUserId]);
  const effectivePriority: PriorityLevel = type === "loot" ? "high" : priority;

  function resetState() {
    setType("normal");
    setPriority("medium");
    setError(null);
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    const title = String(formData.get("title") ?? "");
    const description = String(formData.get("description") ?? "");

    startTransition(async () => {
      const result = await (async () => {
        if (type === "bomb") {
          return createBombTaskAction({
            guildId,
            title,
            description,
            assignedTo: String(formData.get("assignedTo") ?? ""),
            priority: effectivePriority,
          });
        }
        if (type === "duel") {
          return createDuelTaskAction({
            guildId,
            title,
            description,
            opponentId: String(formData.get("opponentId") ?? ""),
            priority: effectivePriority,
          });
        }
        if (type === "loot") {
          return createLootTaskAction({
            guildId,
            title,
            description,
            assignedTo: (formData.get("assignedTo") as string) || null,
          });
        }
        return createTaskAction({
          guildId,
          title,
          description,
          priority: effectivePriority,
          assignedTo: (formData.get("assignedTo") as string) || null,
          dueDate: endOfLocalDayIso(String(formData.get("dueDate") ?? "")),
        });
      })();

      if (result.error) {
        setError(result.error);
      } else {
        setOpen(false);
        resetState();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : (setOpen(false), resetState()))}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" /> New Task
        </Button>
      </DialogTrigger>
      <DialogContent title="Create a task" description="Normal tasks damage the boss. Special types add a twist.">
        <form action={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Task type</Label>
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Task type">
              {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={type === value}
                  onClick={() => setType(value)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[11px] font-semibold transition-colors",
                    type === value
                      ? "border-crimson bg-crimson/15 text-crimson-bright"
                      : "border-surface-border bg-surface text-parchment-dim hover:text-parchment"
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required maxLength={200} placeholder={TITLE_PLACEHOLDER[type]} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" maxLength={500} />
          </div>

          {type === "duel" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="opponentId">Opponent</Label>
              <Select id="opponentId" name="opponentId" required defaultValue="">
                <option value="" disabled>
                  Choose who you&rsquo;re challenging
                </option>
                {opponents.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </Select>
              {opponents.length === 0 && (
                <p className="text-xs text-parchment-faint">No one else has joined this guild yet.</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assignedTo">{type === "bomb" ? "Assign to" : "Assignee"}</Label>
              <Select id="assignedTo" name="assignedTo" defaultValue="" required={type === "bomb"}>
                {type === "bomb" ? (
                  <option value="" disabled>
                    Who&rsquo;s defusing this?
                  </option>
                ) : (
                  <option value="">Unassigned</option>
                )}
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="priority">Priority</Label>
            <Select
              id="priority"
              name="priority"
              value={effectivePriority}
              onChange={(e) => setPriority(e.target.value as PriorityLevel)}
              disabled={type === "loot"}
            >
              <option value="low">Low — {GAME_CONFIG.taskDamage.low} dmg</option>
              <option value="medium">Medium — {GAME_CONFIG.taskDamage.medium} dmg</option>
              <option value="high">High — {GAME_CONFIG.taskDamage.high} dmg</option>
            </Select>
            {type === "loot" && <p className="text-xs text-parchment-faint">Loot tasks are always High priority.</p>}
          </div>

          {type === "normal" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dueDate">Due date</Label>
              <Input id="dueDate" name="dueDate" type="date" min={todayInputValue()} />
            </div>
          )}

          <TypeInfoPanel type={type} priority={effectivePriority} />

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" disabled={isPending} className="mt-1">
            {isPending
              ? "Creating…"
              : type === "bomb"
                ? "Plant bomb"
                : type === "duel"
                  ? "Send challenge"
                  : "Create task"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type InfoTone = "default" | "danger" | "gold" | "crimson";

const TONE_CLASSES: Record<InfoTone, string> = {
  default: "border-surface-border bg-surface text-parchment-dim",
  danger: "border-danger/40 bg-danger/10 text-danger",
  gold: "border-gold/40 bg-gold/10 text-gold-bright",
  crimson: "border-crimson/40 bg-crimson/10 text-crimson-bright",
};

function InfoBox({ tone, children }: { tone: InfoTone; children: ReactNode }) {
  return <div className={cn("rounded-md border px-3 py-2 text-xs leading-relaxed", TONE_CLASSES[tone])}>{children}</div>;
}

function TypeInfoPanel({ type, priority }: { type: TaskTypeChoice; priority: PriorityLevel }) {
  const prefersReducedMotion = useReducedMotion();
  const dmg = GAME_CONFIG.taskDamage[priority];

  let tone: InfoTone = "default";
  let body: ReactNode;

  if (type === "bomb") {
    tone = "danger";
    body = (
      <>
        💣 This task self-destructs {GAME_CONFIG.bomb.durationMinutes} minutes after creation — a real server
        deadline, not your browser clock.
        <br />
        Defuse it (complete it) in time for {dmg} normal damage. Miss it and the whole team loses{" "}
        {GAME_CONFIG.bomb.explosionDamage} HP.
      </>
    );
  } else if (type === "duel") {
    tone = "gold";
    body = (
      <>
        ⚔ Both of you get the same task. First valid completion wins — the winner takes{" "}
        {GAME_CONFIG.duel.rewardMultiplier}× points ({dmg * GAME_CONFIG.duel.rewardMultiplier} XP), the loser gets
        nothing.
      </>
    );
  } else if (type === "loot") {
    tone = "crimson";
    body = (
      <>
        🎁 Deals {dmg} damage like any High task, and hides a random reward — revealed the moment it&rsquo;s
        completed. What&rsquo;s inside stays secret until then.
      </>
    );
  } else {
    body = (
      <>
        ⚔ This task will deal {dmg} damage to the boss.
        {priority === "high" && (
          <>
            <br />
            🎁 High-priority work is also where Loot lives — pick the Loot type above for a chance at a reward.
          </>
        )}
      </>
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={`${type}-${tone}`}
        initial={prefersReducedMotion ? false : { opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={prefersReducedMotion ? undefined : { opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
        <InfoBox tone={tone}>{body}</InfoBox>
      </motion.div>
    </AnimatePresence>
  );
}
