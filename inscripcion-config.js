// ÚNICO enlace para login, alumnos, certificados, inscripciones, matrículas, notas y Gen10.
// Copiar backend/Code-para-Apps-Script.txt en Apps Script y ejecutar configurarTodaLaPlataforma.
// Publicar la implementación y, si cambia su URL, reemplazar solamente apiUrl aquí.
(() => {
  // CONFIGURACIÓN COMPARTIDA. Rutas relativas a la carpeta de este archivo.
  const opciones = {
    apiUrl: 'https://script.google.com/macros/s/AKfycbzvi7DQ90_MiGAU_ArAM1DEQEemQmYmZMAddeT0hcu9hPBj4qyQeyZy7mYnL70KYa0ctA/exec',
    imagenes: {
      logo: 'img/Logogen10.png',
      icono: 'img/Logogen10.png',
      fondoAcceso: 'img/login-study.jpg',
      // Banner decorativo de Gen10: coloca tu imagen en img/ y cambia esta ruta.
      // Recomendado: imagen horizontal (1600 ? 240 px). Usa '' para ocultarlo.
      bannerGen10: 'img/fondo2.png',
      certificado: 'img/certificado.png',
      certificadoCapacitacion: 'img/certificado_capacitacion.png'
    }
  };
  const base = document.currentScript.src;
  const imagenes = Object.freeze(Object.fromEntries(Object.entries(opciones.imagenes)
    .map(([nombre, ruta]) => [nombre, ruta ? new URL(ruta, base).href : ''])));
  window.IFOBE_CONFIG = Object.freeze({apiUrl: opciones.apiUrl, imagenes});
  window.IFOBE_INSCRIPCION = window.IFOBE_CONFIG;
  document.documentElement.style.setProperty('--ifobe-logo', `url(${JSON.stringify(imagenes.logo)})`);
  document.documentElement.style.setProperty('--ifobe-fondo-acceso', `url(${JSON.stringify(imagenes.fondoAcceso)})`);
  function aplicarImagenes() {
    document.querySelectorAll('[data-ifobe-imagen]').forEach(elemento => {
      const ruta = imagenes[elemento.dataset.ifobeImagen];
      if (ruta) elemento.setAttribute(elemento.tagName === 'LINK' ? 'href' : 'src', ruta);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aplicarImagenes);
  else aplicarImagenes();
})();
