"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastVariant = "success" | "error" | "info" | "reward";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Milliseconds before auto-dismiss. 0 keeps it until the player closes it. */
  duration?: number;
}

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (input: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 4;
const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 4000,
  info: 4500,
  reward: 5500,
  // Errors stay long enough to actually read and act on.
  error: 7000,
};

const VARIANT_STYLE: Record<ToastVariant, { icon: typeof Info; border: string; iconColor: string }> = {
  success: { icon: CheckCircle2, border: "border-emerald-500/40", iconColor: "text-emerald-400" },
  error: { icon: AlertTriangle, border: "border-danger/50", iconColor: "text-danger" },
  info: { icon: Info, border: "border-surface-border", iconColor: "text-parchment-dim" },
  reward: { icon: Sparkles, border: "border-gold/50", iconColor: "text-gold-bright" },
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const reduceMotion = useReducedMotion();

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      const variant = input.variant ?? "info";
      setToasts((prev) => [...prev, { id, title: input.title, description: input.description, variant }].slice(-MAX_VISIBLE));

      const duration = input.duration ?? DEFAULT_DURATION[variant];
      if (duration > 0) {
        timers.current.set(id, setTimeout(() => dismiss(id), duration));
      }
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const active = timers.current;
    return () => {
      active.forEach((t) => clearTimeout(t));
      active.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Sits above dialogs (z-50) so an error raised inside a modal is still visible. On phones it
          floats above the bottom nav; on desktop it tucks into the corner. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-4 md:left-auto md:right-4 md:items-end"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const style = VARIANT_STYLE[t.variant];
            const Icon = style.icon;
            return (
              <motion.div
                key={t.id}
                layout={!reduceMotion}
                initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
                transition={{ duration: 0.18 }}
                role={t.variant === "error" ? "alert" : "status"}
                className={cn(
                  "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-surface-raised p-3 shadow-arena",
                  style.border
                )}
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.iconColor)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-parchment">{t.title}</p>
                  {t.description && <p className="mt-0.5 break-words text-xs text-parchment-dim">{t.description}</p>}
                </div>
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={() => dismiss(t.id)}
                  className="-m-1 rounded p-1 text-parchment-faint hover:text-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
