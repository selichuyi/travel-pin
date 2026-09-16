import { computeStats } from './data.js?v=86';

export function renderStats(container, data) {
  const stats = computeStats(data);
  container.innerHTML = `
    <div class="stat">
      <div class="stat-value" data-count="${stats.countries}">0</div>
      <div class="stat-label">国家</div>
    </div>
    <div class="stat">
      <div class="stat-value" data-count="${stats.places}">0</div>
      <div class="stat-label">城市</div>
    </div>
    <div class="stat">
      <div class="stat-value" data-count="${stats.continents}">0</div>
      <div class="stat-label">大洲</div>
    </div>
  `;
  animateCounters(container);
}

function animateCounters(root) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.getAttribute('data-count')) || 0;
    if (reduced) {
      el.textContent = String(target);
      return;
    }
    const duration = 700;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
