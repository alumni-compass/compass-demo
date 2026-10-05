import { DEMO_USER } from "./data";
import type { DemoUser } from "./types";

const KEY = "ritaa-standalone-session";
const SESSION_KEY = "__ritaaStandaloneSession";

type SessionBox = {
  signedIn: boolean;
  hydrated: boolean;
  listeners: Set<() => void>;
};

function session(): SessionBox {
  const host = globalThis as typeof globalThis & { [SESSION_KEY]?: SessionBox };
  if (!host[SESSION_KEY]) {
    host[SESSION_KEY] = { signedIn: true, hydrated: false, listeners: new Set() };
  }
  return host[SESSION_KEY];
}

function emit() {
  for (const listener of session().listeners) listener();
}

function hydrate() {
  const box = session();
  if (box.hydrated || typeof window === "undefined") return;
  box.hydrated = true;
  const stored = window.localStorage.getItem(KEY);
  if (stored === "out") box.signedIn = false;
  if (stored === "in") box.signedIn = true;
}

export function subscribeSession(listener: () => void) {
  const box = session();
  box.listeners.add(listener);
  return () => box.listeners.delete(listener);
}

/** Browser snapshot. Reads the saved sign-in choice after hydration. */
export function getSignedInSnapshot() {
  hydrate();
  return session().signedIn;
}

/** Server snapshot. Always signed in so the first paint matches. */
export function getServerSignedIn() {
  return true;
}

export function currentUser(): DemoUser | null {
  return getSignedInSnapshot() ? DEMO_USER : null;
}

export function currentEmail() {
  return currentUser()?.email.toLowerCase() ?? null;
}

export function signInDemo() {
  session().signedIn = true;
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, "in");
  emit();
}

export function signOutDemo() {
  session().signedIn = false;
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, "out");
  emit();
}
