"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";

export interface Filters {
  bcId: string;
  advertiserId: string;
  appId: string;
  status: string;
  preset: string;
  start: string;
  end: string;
  q: string;
  runningApps: string;
  minCreativeSpend: string;
  page: string;
  pageSize: string;
  sort: string;
  dir: string;
}

const DEFAULTS: Filters = {
  bcId: "",
  advertiserId: "",
  appId: "",
  status: "ACTIVE", // default campaign status filter
  preset: "yesterday", // default date range
  start: "",
  end: "",
  q: "",
  runningApps: "",
  minCreativeSpend: "",
  page: "1",
  pageSize: "50",
  sort: "spend",
  dir: "desc",
};

const LAST_BC = "tacc:lastBc";
const MIN_SPEND = "tacc:minCreativeSpend";

/** Filters live in the URL (shareable, back-button friendly). localStorage only remembers the last BC and threshold. */
export function useFilters(overrides: Partial<Filters> = {}) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters = useMemo(() => {
    const f = { ...DEFAULTS, ...overrides };
    for (const k of Object.keys(DEFAULTS) as (keyof Filters)[]) {
      const v = sp.get(k);
      if (v !== null) f[k] = v;
    }
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  const set = useCallback(
    (patch: Partial<Filters>, opts: { resetPage?: boolean } = { resetPage: true }) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "" || v === DEFAULTS[k as keyof Filters]) next.delete(k);
        else next.set(k, v);
      }
      if (opts.resetPage && !("page" in patch)) next.delete("page");
      if (patch.bcId !== undefined) {
        try {
          if (patch.bcId) localStorage.setItem(LAST_BC, patch.bcId);
        } catch {}
      }
      if (patch.minCreativeSpend !== undefined) {
        try {
          localStorage.setItem(MIN_SPEND, patch.minCreativeSpend);
        } catch {}
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [sp, router, pathname],
  );

  // Restore remembered BC / threshold once, if the URL does not specify them.
  useEffect(() => {
    const patch: Partial<Filters> = {};
    try {
      if (!sp.get("bcId")) {
        const bc = localStorage.getItem(LAST_BC);
        if (bc) patch.bcId = bc;
      }
      if (!sp.get("minCreativeSpend")) {
        const m = localStorage.getItem(MIN_SPEND);
        if (m) patch.minCreativeSpend = m;
      }
    } catch {}
    if (Object.keys(patch).length) set(patch, { resetPage: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Query string for dataset API calls. */
  const apiQuery = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return p;
  }, [filters]);

  return { filters, set, apiQuery };
}
