"use client";

import { createContext, useCallback, useContext, useState } from "react";

type ToastType = "success" | "error" | "info";

interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Reusable toast/snackbar notification. Call `showToast("Saved.", "success")`
 * from any client component nested under <ToastProvider> (mounted once in
 * app/(app)/layout.tsx, so it's available on every authenticated page)
 * instead of relying solely on small inline colored text that's easy to miss.
 */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

let idCounter = 0;

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = ++idCounter;
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 rounded-lg px-4 py-3 text-sm text-white shadow-panel ${
              t.type === "success"
                ? "bg-green-600"
                : t.type === "error"
                  ? "bg-red-600"
                  : "bg-gray-800"
            }`}
          >
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              className="text-white/70 hover:text-white"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
