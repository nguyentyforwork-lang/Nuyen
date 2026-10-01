"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";

/** Minimal data hook: loads on key change, exposes reload (optionally bypassing server cache). */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ path: string; data: T } | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(
    async (refresh = false) => {
      if (!path) return;
      const id = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const url = refresh ? `${path}${path.includes("?") ? "&" : "?"}refresh=1` : path;
        const d = await api<T>(url);
        if (id === seq.current) setState({ path, data: d });
      } catch (e) {
        if (id === seq.current) setError(e as Error);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    // Fetching when the request key changes is exactly what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (path) void load(false);
  }, [path, load]);

  // Data belongs to the path it was loaded for; while a new path loads, keep showing the
  // previous data (dimmed by callers) unless the path was cleared.
  const data = path ? (state?.data ?? null) : null;
  return { data, error: path ? error : null, loading: !!path && loading, reload: load };
}
