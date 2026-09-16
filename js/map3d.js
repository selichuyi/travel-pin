/* 3D globe — globe.gl with glowing points + journey arcs */

let globe = null;
let ready = false;
let onSelect = null;

export function initMap3D(container, handlers = {}) {
  onSelect = handlers.onSelect || null;

  if (typeof Globe !== 'function') {
    console.warn('Globe.gl not available');
    container.innerHTML =
      '<div class="empty-state" style="display:flex;height:100%;align-items:center;justify-content:center">3D 模块未加载，请使用 2D 视图</div>';
    return {
      refresh: () => {},
      stopRotate: () => {},
      startRotate: () => {},
      resize: () => {},
      destroy: () => {}
    };
  }

  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const isLight = theme === 'light';

  try {
    globe = Globe()(container)
      .globeImageUrl(
        isLight
          ? '//unpkg.com/three-globe/example/img/earth-blue-marble.jpg'
          : '//unpkg.com/three-globe/example/img/earth-night.jpg'
      )
      .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
      .showAtmosphere(true)
      .atmosphereColor(isLight ? '#6b8cae' : '#c8a96a')
      .atmosphereAltitude(0.18)
      .pointAltitude(0.012)
      .pointRadius(0.28)
      .pointColor(() => getCss('--accent'))
      .pointLabel(
        (p) =>
          `<div style="font-family:system-ui,sans-serif;padding:6px 8px;background:rgba(10,12,14,.92);color:#f2f1ed;border:1px solid rgba(200,169,106,.35);border-radius:6px;font-size:12px;max-width:200px">
            <div style="font-weight:600">${p.name}</div>
            <div style="opacity:.7;font-size:11px;margin-top:2px">${p.country || ''}${p.date ? ' · ' + p.date : ''}</div>
          </div>`
      )
      .arcColor(() => [
        getCss('--accent'),
        getCss('--accent-glow') || 'rgba(200,169,106,0.3)'
      ])
      .arcAltitudeAutoScale(0.35)
      .arcStroke(0.45)
      .arcDashLength(0.4)
      .arcDashGap(0.15)
      .arcDashAnimateTime(2200)
      .ringsData([])
      .ringColor(() => (t) => `rgba(200,169,106,${1 - t})`)
      .ringMaxRadius(3.2)
      .ringPropagationSpeed(1.6)
      .ringRepeatPeriod(1400)
      .onPointClick((p) => onSelect?.(p));
  } catch (err) {
    console.error('3D init failed', err);
    container.innerHTML =
      '<div class="empty-state" style="display:flex;height:100%;align-items:center;justify-content:center">3D 初始化失败，请使用 2D 视图</div>';
    globe = null;
    return {
      refresh: () => {},
      stopRotate: () => {},
      startRotate: () => {},
      resize: () => {},
      destroy: () => {}
    };
  }

  // Delay ready signal a tick for WebGL init
  setTimeout(() => {
    ready = true;
    document.dispatchEvent(new CustomEvent('map3d-ready'));
  }, 400);

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced) {
    globe.controls().autoRotate = true;
    globe.controls().autoRotateSpeed = 0.45;
  }

  window.addEventListener('travel-theme', () => {
    /* theme textures stay; accent colors read on refresh */
  });

  window.addEventListener('resize', () => {
    if (!globe) return;
    globe.width(container.clientWidth);
    globe.height(container.clientHeight);
  });

  // set size once
  globe.width(container.clientWidth || 800);
  globe.height(container.clientHeight || 600);

  return {
    refresh: refreshMap3D,
    stopRotate: () => {
      if (globe) globe.controls().autoRotate = false;
    },
    startRotate: () => {
      if (globe) globe.controls().autoRotate = true;
    },
    resize: () => {
      if (!globe) return;
      globe.width(container.clientWidth);
      globe.height(container.clientHeight);
    },
    destroy: () => {
      if (globe) {
        globe.controls().autoRotate = false;
        globe._destructor?.();
        globe = null;
      }
      ready = false;
    }
  };
}

export function refreshMap3D(data, options = {}) {
  if (!globe) return;
  const places = options.places || data.places || [];
  const journeys = options.journeys !== undefined ? options.journeys : data.journeys || [];

  const pts = places.map((p) => ({
    ...p,
    lat: p.lat,
    lng: p.lng,
    size: 0.22 + Math.min(0.2, (p.days || 1) * 0.01)
  }));

  globe.pointsData(pts);

  const arcs = [];
  for (const j of journeys) {
    const byId = new Map(places.map((p) => [p.id, p]));
    // Prefer full place set from data for path
    const allPlaces = new Map((data.places || []).map((p) => [p.id, p]));
    const path = j.placeIds
      .map((id) => allPlaces.get(id) || byId.get(id))
      .filter(Boolean);
    for (let i = 0; i < path.length - 1; i++) {
      arcs.push({
        startLat: path[i].lat,
        startLng: path[i].lng,
        endLat: path[i + 1].lat,
        endLng: path[i + 1].lng,
        journeyId: j.id
      });
    }
  }
  globe.arcsData(arcs);

  // Ring pulse only on selected
  const selectedId = options.selectedId;
  const selected = places.find((p) => p.id === selectedId);
  globe.ringsData(selected ? [{ lat: selected.lat, lng: selected.lng }] : []);

  if (options.fit && places.length) {
    const avgLat =
      places.reduce((s, p) => s + p.lat, 0) / places.length;
    const avgLng =
      places.reduce((s, p) => s + p.lng, 0) / places.length;
    globe.pointOfView({ lat: avgLat, lng: avgLng, altitude: 2.4 }, 1000);
  }

  if (options.selectedId && selected) {
    // 点击地点：停止自转并拉近视角（altitude 越小越靠近）
    globe.controls().autoRotate = false;
    globe.pointOfView(
      { lat: selected.lat, lng: selected.lng, altitude: 0.7 },
      900
    );
  }
  window.__travelGlobeState = {
    autoRotate: globe.controls().autoRotate,
    selectedId: selectedId || null,
    pts: pts.length,
    t: Date.now()
  };
}

export function isMap3DReady() {
  return ready && !!globe;
}

function getCss(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim() || '#c8a96a';
}
