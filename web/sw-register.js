// Gelombang 7b / T12 — registrasi Service Worker. Dulu blok <script>
// inline di akhir src/Index.html; kini modul eksternal agar CSP
// script-src bisa menghapus 'unsafe-inline'/'unsafe-eval'.
// HARUS dimuat PALING AKHIR (setelah semua modul UI_PRO): memakai
// window.showPwaUpdateToast dari web/ui-feat-updates.js saat worker
// baru ter-install. Di Capacitor native, registrasi dilewati.
const isCapNative = Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
if ('serviceWorker' in navigator && !isCapNative) {
  let swReloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!swReloading && document.getElementById('pwaUpdateToast')) {
      swReloading = true;
      window.location.reload();
    }
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller && typeof window.showPwaUpdateToast === 'function') {
        window.showPwaUpdateToast(reg);
      }
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller && typeof window.showPwaUpdateToast === 'function') {
            window.showPwaUpdateToast(reg);
          }
        });
      });
    }).catch((err) => {
      console.warn('PWA ServiceWorker error:', err);
    });
  });
}
