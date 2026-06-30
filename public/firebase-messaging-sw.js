/* Vatra FCM service worker — handles background push.
 * Loaded only after the user enables notifications in /portal/notifications.
 * Config is injected via URL query params so we don't ship Firebase keys statically. */
/* eslint-disable */
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

const params = new URL(self.location).searchParams;
const cfg = {
  apiKey: params.get('apiKey') || '',
  projectId: params.get('projectId') || '',
  messagingSenderId: params.get('messagingSenderId') || '',
  appId: params.get('appId') || '',
};

try {
  if (cfg.apiKey && cfg.projectId && cfg.messagingSenderId && cfg.appId) {
    firebase.initializeApp(cfg);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const n = payload.notification || {};
      const data = payload.data || {};
      self.registration.showNotification(n.title || 'Vatra', {
        body: n.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: data.url || '/portal' },
        tag: data.tag || 'vatra',
      });
    });
  }
} catch (e) {
  // swallow — keeps the SW alive even if config is missing
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/portal';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(url); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});