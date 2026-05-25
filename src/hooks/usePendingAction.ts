import { useCallback, useState } from "react";

/** Tracks an in-flight write (POST/DELETE/etc.) and runs async work with a loading label. */
export function usePendingAction() {
  const [pending, setPending] = useState<string | null>(null);

  const run = useCallback(
    async <T>(label: string, fn: (setLabel: (next: string) => void) => Promise<T>): Promise<T> => {
      setPending(label);
      try {
        return await fn(setPending);
      } finally {
        setPending(null);
      }
    },
    []
  );

  return { pending, run, isPending: pending !== null };
}
