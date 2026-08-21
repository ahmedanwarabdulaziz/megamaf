/// <reference lib="webworker" />

import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// MegaMaf contains private financial and operational data. Only versioned
// build assets are precached; pages, RSC payloads, APIs, and attachments are
// deliberately left network-only by defining no runtime cache routes.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [],
});

// Remove every cache created by the previous Workbox worker. The new worker
// only owns Serwist's versioned precache, so no authenticated response can
// survive the migration on a shared browser profile.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => !cacheName.startsWith("serwist-precache"))
          .map((cacheName) => caches.delete(cacheName)),
      ),
    ),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json() as {
      title?: string;
      body?: string;
      url?: string;
    };

    event.waitUntil(
      self.registration.showNotification(data.title || "New Notification", {
        body: data.body,
        icon: "/icon-192x192.png",
        badge: "/icon-192x192.png",
        data: { url: data.url || "/" },
      }),
    );
  } catch (error) {
    console.error("Error parsing push notification:", error);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url;
  if (!targetUrl) return;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        const client = clientList.find((item) => item.focused) ?? clientList[0];
        if (client) {
          await client.focus();
          return client.navigate(targetUrl);
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});

serwist.addEventListeners();