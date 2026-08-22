// Deliberately does no caching — every page here can show a tenant's rent
// balance or a payment that just posted, and serving a stale cached copy of
// any of that would be worse than requiring network access. This exists
// only so the app qualifies as an installable PWA (Chrome/Android and the
// Trusted Web Activity wrapper both require a registered service worker),
// not to work offline.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
