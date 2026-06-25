/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    
    event.waitUntil(
      sw.registration.showNotification(data.title || "New Notification", {
        body: data.body,
        icon: "/icon-192x192.png",
        badge: "/icon-192x192.png",
        data: {
          url: data.url || "/",
        },
      })
    );
  } catch (error) {
    console.error("Error parsing push notification:", error);
  }
});

sw.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.notification.data && event.notification.data.url) {
    event.waitUntil(
      sw.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          if (clientList.length > 0) {
            let client = clientList[0];
            for (let i = 0; i < clientList.length; i++) {
              if (clientList[i].focused) {
                client = clientList[i];
              }
            }
            if ("focus" in client) {
              return client.focus().then(() => client.navigate(event.notification.data.url));
            }
          }
          return sw.clients.openWindow(event.notification.data.url);
        })
    );
  }
});
