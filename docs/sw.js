// Service worker de MindBalance.
//
// REGLA INNEGOCIABLE: nada de /api/ ni /auth/ toca jamás la caché. Ahí viajan el
// diario, las reflexiones y el estado de ánimo; dejar eso escrito en el disco del
// dispositivo, fuera del cifrado y sobreviviendo al cierre de sesión, sería la peor
// fuga posible en esta app. La caché guarda ÚNICAMENTE el cascarón: HTML sin datos,
// JS, CSS e íconos.
//
// La app es local-first, así que sin conexión sigue siendo completamente usable:
// lo que falta offline es la sincronización y la reflexión con IA, no la app.

const CACHE = "mb-shell-v1";
const PRECACHE = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Si un recurso falla, no se cae la instalación entera.
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Todo lo que lleve datos de la persona usuaria. Nunca se cachea, ni se intercepta. */
function esDatosDeUsuario(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (esDatosDeUsuario(url)) return; // pasa directo a la red, sin nosotros en medio

  // Navegaciones: primero la red (para no servir una versión vieja de la app),
  // con la caché como red de seguridad cuando no hay señal.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
          return res;
        })
        .catch(async () => (await caches.match(req)) ?? (await caches.match("/")) ?? Response.error()),
    );
    return;
  }

  // Estáticos de Next: llevan hash en el nombre, así que la caché nunca queda obsoleta.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            const copia = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
            return res;
          }),
      ),
    );
    return;
  }

  // Resto de estáticos (íconos, manifest): sirve de caché y revalida en segundo plano.
  event.respondWith(
    caches.match(req).then((hit) => {
      const red = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copia = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return res;
        })
        .catch(() => hit ?? Response.error());
      return hit ?? red;
    }),
  );
});
