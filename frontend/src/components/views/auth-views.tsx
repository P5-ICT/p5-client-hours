"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError, api, tokenStore } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { Page } from "../app-shell";
import { Button, Buttons, Card, Field, FormError, PageHead, cn, focusField } from "../ui/primitives";

const MIN_PASSWORD = 10;

function Frame({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <main id="main" className={cn("mx-auto grid max-w-[460px] gap-5 px-4 pt-8 pb-12")}>
      <PageHead title={title}>{intro}</PageHead>
      <Card>{children}</Card>
    </main>
  );
}

const linkClass = "inline-flex min-h-11 items-center text-sm font-semibold text-accent underline";

export function LoginView() {
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const email = String(f.get("email") ?? "").trim();
    const password = String(f.get("password") ?? "");
    if (!email || !password) {
      setError("Enter your email and password.");
      focusField(email ? "l-password" : "l-email");
      return;
    }
    setBusy(true);
    try {
      await login(email, password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not sign in. Try again.");
      focusField("l-password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame title="Sign in" intro="Use the email address your manager added to Client Hours.">
      <form noValidate onSubmit={submit} className="grid gap-3">
        <Field label="Email" htmlFor="l-email">
          <input id="l-email" name="email" type="email" autoComplete="username" inputMode="email" required />
        </Field>
        <Field label="Password" htmlFor="l-password">
          <input id="l-password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <FormError message={error} />
        <Buttons>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <Link href="/forgot-password" className={linkClass}>
            Forgot your password?
          </Link>
        </Buttons>
      </form>
    </Frame>
  );
}

export function SetPasswordView() {
  const token = useSearchParams().get("token") ?? "";
  const { startSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const password = String(f.get("password") ?? "");
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return focusField("sp-password");
    }
    if (password !== String(f.get("again") ?? "")) {
      setError("The two passwords are not the same.");
      return focusField("sp-again");
    }
    setBusy(true);
    try {
      startSession(await api.setPassword(token, password));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the password. Try again.");
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <Frame title="Link not valid">
        <p>This link is incomplete. Open the link from your email again, or ask for a new one.</p>
        <Link href="/forgot-password" className={linkClass}>
          Send me a new link
        </Link>
      </Frame>
    );
  }

  return (
    <Frame title="Choose a password" intro={`At least ${MIN_PASSWORD} characters. A few words in a row works well.`}>
      <form noValidate onSubmit={submit} className="grid gap-3">
        <Field label="New password" htmlFor="sp-password">
          <input id="sp-password" name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} />
        </Field>
        <Field label="Type it again" htmlFor="sp-again">
          <input id="sp-again" name="again" type="password" autoComplete="new-password" required />
        </Field>
        <FormError message={error} />
        <Buttons>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save and sign in"}
          </Button>
        </Buttons>
        {error?.includes("expired") && (
          <Link href="/forgot-password" className={linkClass}>
            Send me a new link
          </Link>
        )}
      </form>
    </Frame>
  );
}

export function ForgotPasswordView() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const email = String(new FormData(ev.currentTarget).get("email") ?? "").trim();
    if (!email) {
      setError("Enter your email address.");
      return focusField("fp-email");
    }
    setBusy(true);
    try {
      await api.forgot(email);
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send the email. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Frame title="Check your email">
        <p>If that address has an account, a link to choose a new password is on its way. It works for 7 days.</p>
        <Link href="/login" className={linkClass}>
          Back to sign in
        </Link>
      </Frame>
    );
  }

  return (
    <Frame title="Forgot your password?" intro="Enter your email and we will send you a link to choose a new one.">
      <form noValidate onSubmit={submit} className="grid gap-3">
        <Field label="Email" htmlFor="fp-email">
          <input id="fp-email" name="email" type="email" autoComplete="username" inputMode="email" required />
        </Field>
        <FormError message={error} />
        <Buttons>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send the link"}
          </Button>
          <Link href="/login" className={linkClass}>
            Back to sign in
          </Link>
        </Buttons>
      </form>
    </Frame>
  );
}

/** Signed-in people change their own password here. Every other device is signed out; this one stays signed in. */
export function AccountView() {
  const { user } = useAuth();
  const { showToast } = useStore();
  const [error, setError] = useState<{ message: string; field: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const current = String(f.get("current") ?? "");
    const next = String(f.get("next") ?? "");
    const fail = (message: string, field: string) => {
      setError({ message, field });
      focusField(field);
    };
    if (!current) return fail("Enter your current password.", "ac-current");
    if (next.length < MIN_PASSWORD) return fail(`Use at least ${MIN_PASSWORD} characters for the new password.`, "ac-next");
    if (next !== String(f.get("again") ?? "")) return fail("The two new passwords are not the same.", "ac-again");
    setBusy(true);
    try {
      const r = await api.changePassword(current, next);
      // The old token no longer works, so keep this device signed in with the new one.
      tokenStore.set(r.token);
      setError(null);
      form.reset();
      showToast("Password changed. Your other devices were signed out.");
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      fail(err?.message ?? "Could not change the password. Try again.", err?.field === "current" ? "ac-current" : "ac-next");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHead title="Your account">
        {user?.name} · {user?.email}
      </PageHead>
      <div className="max-w-[460px]">
        <Card>
          <h3 className="font-bold">Change your password</h3>
          <p className="text-sm text-muted">Anywhere else you are signed in, you will be asked to sign in again.</p>
          <form noValidate onSubmit={submit} className="grid gap-3">
            <Field label="Current password" htmlFor="ac-current" error={error?.field === "ac-current" ? error.message : null}>
              <input id="ac-current" name="current" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="New password" htmlFor="ac-next" hint={`At least ${MIN_PASSWORD} characters.`} error={error?.field === "ac-next" ? error.message : null}>
              <input id="ac-next" name="next" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} />
            </Field>
            <Field label="Type the new password again" htmlFor="ac-again" error={error?.field === "ac-again" ? error.message : null}>
              <input id="ac-again" name="again" type="password" autoComplete="new-password" required />
            </Field>
            <Buttons>
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Change password"}
              </Button>
            </Buttons>
          </form>
        </Card>
      </div>
    </Page>
  );
}
