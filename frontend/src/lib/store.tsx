"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, type SessionUser } from "./api";
import { useAuth } from "./auth";
import type { AppData, Prefs } from "./types";

interface StoreValue {
  /** False until the first load from the server has finished. */
  ready: boolean;
  /** Set when the data could not be loaded. */
  loadError: string | null;
  data: AppData;
  me: SessionUser;
  /** Kept so screens can ask "whose entries": always the signed-in person. */
  prefs: Prefs;
  /** Change the local copy only (for text the person is typing). The server is updated separately. */
  update: (fn: (d: AppData) => AppData) => void;
  /**
   * Show a change at once, send it to the server, then reload the real data.
   * If the server refuses, the screen goes back to the real data and the reason is shown.
   * Resolves true when the server accepted it.
   */
  mutate: <T>(
    optimistic: ((d: AppData) => AppData) | null,
    request: () => Promise<T>,
    /** Pass `{ toast: false }` when the screen shows the error next to the field instead. */
    opts?: { toast?: boolean },
  ) => Promise<{ ok: true; value: T } | { ok: false; error: ApiError }>;
  /** Save timer text a moment after the person stops typing. */
  saveTimerText: (patch: { note?: string; proof?: string }) => void;
  /** Make sure at least `cycles` cycles of entries (the current one included) are loaded. */
  loadHistory: (cycles: number) => Promise<void>;
  refresh: () => Promise<void>;
  toast: string | null;
  showToast: (msg: string) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

const REFRESH_MS = 60_000;
const TEXT_SAVE_MS = 600;
/** Matches the server default: the current cycle and the one before it. */
const DEFAULT_CYCLES = 2;

interface Loaded {
  data: AppData;
  me: SessionUser;
}

/** One timer that can be restarted or cleared. Kept in a closure, not a React ref, so it never leaks into rendering. */
function createDelay() {
  let id: ReturnType<typeof setTimeout> | undefined;
  return {
    set(fn: () => void, ms: number) {
      clearTimeout(id);
      id = setTimeout(fn, ms);
    },
    clear() {
      clearTimeout(id);
    },
  };
}

/** Remembers how far back the person has looked, so later refreshes keep the older cycles they opened. */
function createCycles(initial: number) {
  let n = initial;
  return {
    get: () => n,
    /** True when this asks for more than is already loaded. */
    raise(to: number) {
      if (to <= n) return false;
      n = to;
      return true;
    },
  };
}

/** Collects what the person types into the running timer's note and link, and saves it once they pause. */
function createTextSaver() {
  const delay = createDelay();
  let pending: { note?: string; proof?: string } | null = null;
  const flush = async () => {
    delay.clear();
    const patch = pending;
    pending = null;
    if (patch) await api.patchTimer(patch).catch(() => {});
  };
  return {
    hasPending: () => pending !== null,
    flush,
    save(patch: { note?: string; proof?: string }) {
      pending = { ...pending, ...patch };
      delay.set(() => void flush(), TEXT_SAVE_MS);
    },
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastDelay] = useState(createDelay);
  const [saver] = useState(createTextSaver);
  const [cycles] = useState(() => createCycles(DEFAULT_CYCLES));

  const showToast = useCallback(
    (msg: string) => {
      setToast(msg);
      toastDelay.set(() => setToast(null), 3200);
    },
    [toastDelay],
  );

  const refresh = useCallback(async () => {
    // Do not replace what the person is typing with an older copy from the server.
    if (saver.hasPending()) return;
    try {
      const r = await api.data(cycles.get());
      // The server clock and this device's clock can differ; shift timer start times so the shown time is right.
      const skew = Date.now() - r.serverNow;
      const timers = Object.fromEntries(Object.entries(r.data.timers).map(([k, t]) => [k, { ...t, startedAt: t.startedAt + skew }]));
      setLoaded({ data: { ...r.data, timers }, me: r.me });
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Could not load your hours.");
    }
  }, [saver, cycles]);

  const loadHistory = useCallback(
    async (wanted: number) => {
      if (cycles.raise(wanted)) await refresh();
    },
    [cycles, refresh],
  );

  // Load when signed in; clear everything when signed out so the next person never sees the last person's data.
  const userId = user?.id;
  useEffect(() => {
    if (status !== "in") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoaded(null);
      return;
    }
    void refresh();
  }, [status, userId, refresh]);

  // Keep several devices in step: reload when the tab is shown again, and every minute while it is open.
  useEffect(() => {
    if (status !== "in") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(onVisible, REFRESH_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(id);
    };
  }, [status, refresh]);

  const update = useCallback((fn: (d: AppData) => AppData) => {
    setLoaded((s) => (s ? { ...s, data: fn(s.data) } : s));
  }, []);

  const saveTimerText = saver.save;

  const mutate = useCallback<StoreValue["mutate"]>(
    async (optimistic, request, opts) => {
      if (optimistic) update(optimistic);
      try {
        await saver.flush();
        const value = await request();
        await refresh();
        return { ok: true, value };
      } catch (e) {
        const error = e instanceof ApiError ? e : new ApiError("Something went wrong. Try again.", 0);
        if (opts?.toast !== false) showToast(error.message);
        await refresh();
        return { ok: false, error };
      }
    },
    [update, saver, refresh, showToast],
  );

  const value = useMemo<StoreValue | null>(() => {
    if (!loaded) return null;
    return {
      ready: true,
      loadError,
      data: loaded.data,
      me: loaded.me,
      prefs: { staffId: loaded.me.id, managerId: loaded.me.id },
      update,
      mutate,
      saveTimerText,
      loadHistory,
      refresh,
      toast,
      showToast,
    };
  }, [loaded, loadError, update, mutate, saveTimerText, loadHistory, refresh, toast, showToast]);

  // Before the first load there is no data. Screens are not rendered until `ready`, so the placeholder is never read.
  const placeholder = useMemo<StoreValue>(
    () => ({
      ready: false,
      loadError,
      data: null as unknown as AppData,
      me: null as unknown as SessionUser,
      prefs: { staffId: "", managerId: "" },
      update,
      mutate,
      saveTimerText,
      loadHistory,
      refresh,
      toast,
      showToast,
    }),
    [loadError, update, mutate, saveTimerText, loadHistory, refresh, toast, showToast],
  );

  return <StoreContext.Provider value={value ?? placeholder}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}
