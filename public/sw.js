// public/sw.js
self.addEventListener("install", (event) => {
  // You can add caching here later if you want offline support
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});
