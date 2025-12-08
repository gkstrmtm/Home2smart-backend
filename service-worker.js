// Home2Smart Dispatch Portal - Service Worker
// Provides offline capability and performance optimization through caching

const CACHE_VERSION = 'h2s-portal-v2-login-fix';
const CACHE_ASSETS = [
  '/',
  '/portalv3.html',
];

// API responses to cache (with 10min TTL)
const API_CACHE = 'h2s-api-cache-v1';
const API_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Install event - cache core assets
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing...');
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => {
        console.log('[ServiceWorker] Caching app shell');
        return cache.addAll(CACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_VERSION && cacheName !== API_CACHE) {
            console.log('[ServiceWorker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - network-first strategy for API, cache-first for assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // API requests - network first with cache fallback
  if (url.origin.includes('vercel.app') || url.pathname.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful GET responses
          if (event.request.method === 'GET' && response.ok) {
            const responseClone = response.clone();
            caches.open(API_CACHE).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Network failed, try cache
          return caches.match(event.request).then((cached) => {
            if (cached) {
              console.log('[ServiceWorker] Serving cached API response:', url.pathname);
              return cached;
            }
            // Return offline fallback
            return new Response(
              JSON.stringify({ 
                ok: false, 
                error: 'Offline - cached data unavailable',
                error_code: 'offline'
              }),
              { 
                status: 503,
                headers: { 'Content-Type': 'application/json' }
              }
            );
          });
        })
    );
    return;
  }
  
  // Static assets - cache first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        return caches.open(CACHE_VERSION).then((cache) => {
          cache.put(event.request, response.clone());
          return response;
        });
      });
    })
  );
});

// Background sync for offline job updates (future enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-job-status') {
    event.waitUntil(syncJobUpdates());
  }
});

async function syncJobUpdates() {
  // Placeholder for syncing job status changes made while offline
  console.log('[ServiceWorker] Background sync triggered');
}
