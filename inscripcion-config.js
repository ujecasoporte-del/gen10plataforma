// ÚNICO enlace para login, alumnos, certificados, inscripciones, matrículas, notas y Gen10.
// Copiar backend/Code-para-Apps-Script.txt en Apps Script y ejecutar configurarTodaLaPlataforma.
// Publicar la implementación y, si cambia su URL, reemplazar solamente apiUrl aquí.
(() => {
  // CONFIGURACIÓN COMPARTIDA. Rutas relativas a la carpeta de este archivo.
  const opciones = {
    // Activa el aviso en todas las páginas publicando este archivo con activo: true.
    mantenimiento: {activo: false, mensaje: 'Estamos trabajando para brindarte una mejor experiencia. Gracias por tu paciencia.'},
    apiUrl: 'https://script.google.com/macros/s/AKfycbygn1x0Z9CuxcdGJGEGljAvtDx62pLKu2DRXHO_Rh-Y87MANrIUcaAvu3RCh9s5HgsOyQ/exec',
    imagenes: {
      logo: 'img/Logogen10.png',
      icono: 'img/Logogen10.png',
      fondoAcceso: 'img/campus-universitario.png',
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
  const mantenimiento = Object.freeze({...opciones.mantenimiento});
  window.IFOBE_CONFIG = Object.freeze({apiUrl: opciones.apiUrl, imagenes, mantenimiento});
  window.IFOBE_INSCRIPCION = window.IFOBE_CONFIG;
  const avisoUrl = new URL('mantenimiento.html', base);
  if (mantenimiento.activo && window.location.pathname !== avisoUrl.pathname) {
    window.location.replace(avisoUrl.href);
  }
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
