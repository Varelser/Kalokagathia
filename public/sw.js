// Minimal service worker: enables PWA installability without caching anything,
// so the installed app always loads the latest deployment from the network.
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', () => {
  // Network passthrough (no respondWith): updates apply on next launch.
});
