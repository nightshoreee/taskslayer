"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { endOfLocalDayIso, isoToLocalDateInput, todayInputValue } from "@/lib/utils";
import { updateTaskAction } from "@/lib/actions/tasks";
import { useToast } from "@/components/ui/toast";
import type { Profile, Task } from "@/types/database";

/**
 * Edit title / description / assignee / due date of an open ordinary task.
 * Damage and points are deliberately absent: they're stamped by the database
 * when the task is created and can't be changed afterwards.
 */
export function EditTaskDialog({
  task,
  members,
  onClose,
}: {
  task: Task | null;
  members: Profile[];
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  // Once a task is overdue the database refuses to reschedule it (otherwise the
  // penalty could be dodged by pushing the date after the fact).
  const overdue = !!task?.due_date && new Date(task.due_date).getTime() <= Date.now();
  const originalDate = task?.due_date ? isoToLocalDateInput(task.due_date) : "";

  function handleSubmit(formData: FormData) {
    if (!task) return;
    setError(null);
    const dateValue = String(formData.get("dueDate") ?? "");
    const dueDateChanged = dateValue !== originalDate;

    startTransition(async () => {
      const result = await updateTaskAction(task.id, {
        title: String(formData.get("title") ?? ""),
        description: String(formData.get("description") ?? ""),
        assignedTo: (formData.get("assignedTo") as string) || null,
        dueDate: dateValue ? endOfLocalDayIso(dateValue) : null,
        dueDateChanged,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast({ title: "Task updated", variant: "success" });
      onClose();
    });
  }

  return (
    <Dialog open={task !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent title="Edit task" description="Damage is fixed when a task is created.">
        {task && (
          <form key={task.id} action={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-title">Title</Label>
              <Input id="edit-title" name="title" required maxLength={200} defaultValue={task.title} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea id="edit-description" name="description" maxLength={500} defaultValue={task.description ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-assignee">Assignee</Label>
              <Select id="edit-assignee" name="assignedTo" defaultValue={task.assigned_to ?? ""}>
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-due">Due date</Label>
              <Input
                id="edit-due"
                name="dueDate"
                type="date"
                min={todayInputValue()}
                defaultValue={originalDate}
                disabled={overdue}
              />
              {overdue && (
                <p className="text-xs text-parchment-faint">This task is already overdue, so its date can&rsquo;t be moved.</p>
              )}
            </div>

            {error && (
              <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
