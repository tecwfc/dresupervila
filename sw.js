const CACHE_NAME = 'supervila-dre-v4';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './offline.html'
];

// Instalação do Service Worker
self.addEventListener('install', event => {
  console.log('Service Worker: Instalando...');
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Cacheando arquivos');
        return cache.addAll(urlsToCache).catch(error => {
          console.log('Erro ao cachear:', error);
          // Não falhar se um arquivo não existir
          return Promise.all(
            urlsToCache.map(url => 
              cache.add(url).catch(err => console.log(`Não foi possível cachear ${url}`))
            )
          );
        });
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
      return self.clients.claim();
    })
  );
});

// Interceptar requisições
self.addEventListener('fetch', event => {
  // Ignorar requisições para APIs e arquivos externos
  if (event.request.url.includes('script.google.com') || 
      event.request.url.includes('googleapis') ||
      event.request.url.includes('cloudflare') ||
      event.request.url.includes('jsdelivr') ||
      event.request.url.includes('font-awesome') ||
      event.request.url.includes('fonts.googleapis') ||
      event.request.method !== 'GET') {
    return;
  }

  // Estratégia: Network first, fallback para cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Se a requisição for bem-sucedida, clonar e guardar no cache
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Se falhar, tentar buscar do cache
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          
          // Se for uma requisição de página HTML, mostrar página offline
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('./offline.html');
          }
          
          return new Response('Offline', { 
            status: 503, 
            statusText: 'Service Unavailable' 
          });
        });
      })
  );
});