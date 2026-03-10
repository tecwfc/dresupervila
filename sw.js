const CACHE_NAME = 'supervila-dre-v5'; // Incrementar versão
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/offline.html',
  // Assets
  '/assets/icon-72x72.png',
  '/assets/icon-96x96.png',
  '/assets/icon-128x128.png',
  '/assets/icon-144x144.png',
  '/assets/icon-152x152.png',
  '/assets/icon-192x192.png',
  '/assets/icon-384x384.png',
  '/assets/icon-512x512.png',
  '/assets/logo_supervila.png',
  '/assets/logo_supervila.jpg'
];

// Instalação do Service Worker
self.addEventListener('install', event => {
  console.log('Service Worker: Instalando versão', CACHE_NAME);
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Cacheando arquivos');
        return Promise.allSettled( // Usar allSettled para não falhar se um arquivo não existir
          urlsToCache.map(url => 
            cache.add(url).catch(err => {
              console.log(`Não foi possível cachear ${url}:`, err.message);
              return Promise.resolve(); // Não falhar
            })
          )
        );
      })
      .then(() => {
        console.log('Service Worker: Cache completo');
      })
  );
});

// Ativação
self.addEventListener('activate', event => {
  console.log('Service Worker: Ativando...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Removendo cache antigo', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker: Pronto para controlar os clientes');
      return self.clients.claim();
    })
  );
});

// Interceptar requisições
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Ignorar requisições para APIs e arquivos externos
  if (url.hostname.includes('script.google.com') || 
      url.hostname.includes('googleapis') ||
      url.hostname.includes('cloudflare') ||
      url.hostname.includes('jsdelivr') ||
      url.hostname.includes('font-awesome') ||
      url.hostname.includes('fonts.googleapis') ||
      event.request.method !== 'GET') {
    return;
  }

  // Estratégia: Network first para HTML, Cache first para assets
  if (event.request.headers.get('accept')?.includes('text/html')) {
    // Para páginas HTML: network first, fallback para cache, depois offline.html
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            return caches.match('/offline.html');
          });
        })
    );
  } else {
    // Para assets (CSS, JS, imagens): cache first, network fallback
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          // Buscar atualização em background
          fetch(event.request).then(response => {
            if (response && response.status === 200) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, response);
              });
            }
          }).catch(() => {});
          
          return cachedResponse;
        }
        
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        }).catch(error => {
          console.log('Erro ao buscar asset:', error);
          // Retornar resposta vazia para assets que falharam
          if (event.request.url.includes('.png') || event.request.url.includes('.jpg') || event.request.url.includes('.jpeg')) {
            return new Response('', { status: 200, statusText: 'OK' });
          }
          return new Response('', { status: 200, statusText: 'OK' });
        });
      })
    );
  }
});
