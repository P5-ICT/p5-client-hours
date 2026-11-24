"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler, tokenStore, type Session, type SessionUser } from "./api";
import type { AppRole, Role } from "./types";

type Status = "loading" | "out" | "in";

interface AuthValue {
  status: Status;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<void>;
  /** Used after an invite or reset link: the server signs the person in. */
  startSession: (s: Session) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);

  const clear = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    setStatus("out");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    return () => setUnauthorizedHandler(null);
  }, [clear]);

  useEffect(() => {
    // The token lives in browser storage, so the first check has to happen after mount.
    if (!tokenStore.get()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("out");
      return;
    }
    api
      .me()
      .then((r) => {
        setUser(r.user);
        setStatus("in");
      })
      .catch((e) => {
        // A network failure should not sign the person out; only a rejected token does (handled in the api layer).
        if (e?.status === 401 || e?.status === 403) clear();
        else setStatus("out");
      });
  }, [clear]);

  const startSession = useCallback((s: Session) => {
    tokenStore.set(s.token);
    setUser(s.user);
    setStatus("in");
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      startSession(await api.login(email, password));
    },
    [startSession],
  );

  const value = useMemo<AuthValue>(() => ({ status, user, login, startSession, logout: clear }), [status, user, login, startSession, clear]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Which parts of the app each kind of account can open. */
export function sectionsFor(role: AppRole): Role[] {
  if (role === "client") return ["client"];
  if (role === "staff") return ["staff"];
  return ["staff", "manager"];
}

/** Where a person lands after signing in. */
export function homeFor(role: AppRole): string {
  if (role === "client") return "/client/report";
  if (role === "staff") return "/staff/track";
  if (role === "admin") return "/manager/overview";
  return "/manager/approvals";
}

export const canApproveRole = (role: AppRole) => role === "manager" || role === "ceo";
export const isAdminRole = (role: AppRole) => role === "admin";
/** Managers, the CEO and admins add people. Managers and the CEO can add staff and client accounts only. */
export const canAddPeopleRole = (role: AppRole) => role === "manager" || role === "ceo" || role === "admin";
