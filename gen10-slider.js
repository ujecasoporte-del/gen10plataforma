(() => {
  const banner = document.querySelector('.campus-slider');
  const ruta = window.IFOBE_CONFIG?.imagenes?.bannerGen10;
  if (!banner || !ruta) return;
  const imagen = banner.querySelector('img');
  imagen.addEventListener('load', () => { banner.hidden = false; });
  imagen.addEventListener('error', () => { banner.hidden = true; });
  imagen.src = ruta;
})();
