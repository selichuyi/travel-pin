/* Timeline year strip — year ranges expand across all covered years */

import { yearsOfDate } from './data.js?v=86';

export function initTimeline(root, onSelectYear) {
  root.innerHTML = `
    <span class="timeline-label">时间线</span>
    <div class="timeline-track" id="timeline-track"></div>
  `;

  root.querySelector('#timeline-track').addEventListener('click', (e) => {
    const btn = e.target.closest('.year-btn');
    if (!btn) return;
    const year = btn.getAttribute('data-year');
    const current = btn.classList.contains('is-active');
    onSelectYear?.(current ? 'all' : year);
  });

  return {
    update(data, activeYear = 'all') {
      const track = root.querySelector('#timeline-track');
      const counts = {};
      for (const p of data.places) {
        const years = [
          ...new Set([...yearsOfDate(p.date), ...yearsOfDate(p.endDate)])
        ];
        if (!years.length) continue;
        for (const y of years) {
          counts[y] = (counts[y] || 0) + 1;
        }
      }
      const years = Object.keys(counts).sort();
      const allCount = data.places.length;

      track.innerHTML = `
        <button type="button" class="year-btn ${activeYear === 'all' ? 'is-active' : ''}" data-year="all">
          <span class="y">全部</span>
          <span class="bar"></span>
          <span class="n">${allCount}</span>
        </button>
        ${years
          .map(
            (y) => `
          <button type="button" class="year-btn ${activeYear === y ? 'is-active' : ''}" data-year="${y}">
            <span class="y">${y}</span>
            <span class="bar"></span>
            <span class="n">${counts[y]}</span>
          </button>
        `
          )
          .join('')}
      `;

      const active = track.querySelector('.year-btn.is-active');
      active?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  };
}
