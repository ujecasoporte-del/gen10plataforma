(() => {
  const slider = document.querySelector('.campus-slider');
  if (!slider) return;
  const slides = [...slider.querySelectorAll('.campus-slide')];
  const pause = slider.querySelector('[data-slider-pause]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0, paused = reducedMotion.matches, hovered = false;
  function show(next) {
    index = (next + slides.length) % slides.length;
    slides.forEach((slide, i) => { slide.hidden = i !== index; });
    slider.querySelector('[data-slider-count]').textContent = `${index + 1} / ${slides.length}`;
  }
  function updatePause() {
    pause.textContent = paused ? 'Reanudar' : 'Pausar';
    pause.setAttribute('aria-pressed', String(paused));
  }
  slider.querySelector('[data-slider-prev]').addEventListener('click', () => show(index - 1));
  slider.querySelector('[data-slider-next]').addEventListener('click', () => show(index + 1));
  pause.addEventListener('click', () => { paused = !paused; updatePause(); });
  slider.addEventListener('mouseenter', () => { hovered = true; });
  slider.addEventListener('mouseleave', () => { hovered = false; });
  reducedMotion.addEventListener('change', event => { paused = event.matches; updatePause(); });
  updatePause();
  setInterval(() => {
    if (!paused && !hovered && !document.hidden && !document.getElementById('campus').hidden && !slider.contains(document.activeElement)) show(index + 1);
  }, 6000);
})();
