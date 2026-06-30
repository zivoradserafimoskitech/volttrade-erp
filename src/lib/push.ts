import { initializeApp, getApps } from "firebase/app";
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { supabase } from "@/integrations/supabase/client";

// Firebase web config — these are publishable (safe in client). The actual
// sender authority lives in the service-account JSON on the backend.
// Values are injected at runtime so the build doesn't require them.
export const firebaseConfig = {
  apiKey: (import.meta as any).env?.VITE_FIREBASE_API_KEY || "",
  projectId: (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID || "",
  messagingSenderId: (import.meta as any).env?.VITE_FIREBASE_SENDER_ID || "",
  appId: (import.meta as any).env?.VITE_FIREBASE_APP_ID || "",
};

export const vapidKey = (import.meta as any).env?.VITE_FIREBASE_VAPID_KEY || "";

export function pushConfigured() {
  return !!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId && vapidKey);
}

let messagingInstance: ReturnType<typeof getMessaging> | null = null;

async function ensureMessaging() {
  if (!pushConfigured()) throw new Error("Firebase not configured");
  if (!(await isSupported())) throw new Error("Push not supported in this browser");
  if (!getApps().length) initializeApp(firebaseConfig);
  if (!messagingInstance) messagingInstance = getMessaging();
  return messagingInstance!;
}

async function registerSw() {
  const q = new URLSearchParams({
    apiKey: firebaseConfig.apiKey,
    projectId: firebaseConfig.projectId,
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId,
  }).toString();
  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${q}`, { scope: "/firebase-cloud-messaging-push-scope" });
}

export async function enablePush(): Promise<{ ok: boolean; reason?: string; token?: string }> {
  try {
    if (!("Notification" in window)) return { ok: false, reason: "Browser has no Notification API" };
    if (!pushConfigured()) return { ok: false, reason: "Firebase web keys not configured yet" };
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, reason: "Permission denied" };
    const messaging = await ensureMessaging();
    const swReg = await registerSw();
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swReg });
    if (!token) return { ok: false, reason: "No token returned" };
    const { data: u } = await supabase.auth.getUser();
    if (u.user) {
      await supabase.from("device_tokens").upsert(
        { user_id: u.user.id, token, platform: "web", user_agent: navigator.userAgent, last_seen: new Date().toISOString() },
        { onConflict: "token" }
      );
    }
    return { ok: true, token };
  } catch (e: any) {
    return { ok: false, reason: e?.message || "Failed to enable push" };
  }
}

export async function disablePush(token?: string) {
  if (token) await supabase.from("device_tokens").delete().eq("token", token);
}

export function onForegroundMessage(cb: (payload: any) => void) {
  ensureMessaging()
    .then((m) => onMessage(m, cb))
    .catch(() => {});
}