(function () {
  'use strict';

  const STORAGE_KEY = 'meteo-nordica-v1';
  const INDOOR_KEY = 'meteo-nordica-indoor';
  const GEO_TIMEOUT_MS = 12000;

  const $ = (id) => document.getElementById(id);

  const els = {
    searchForm: $('searchForm'),
    cityInput: $('cityInput'),
    btnGeo: $('btnGeo'),
    btnInstall: $('btnInstall'),
    locationName: $('locationName'),
    locationMeta: $('locationMeta'),
    skeleton: $('skeleton'),
    contentLoaded: $('contentLoaded'),
    heroIconWrap: $('heroIconWrap'),
    forecastList: $('forecastList'),
    currentTemp: $('currentTemp'),
    currentDesc: $('currentDesc'),
    currentTagline: $('currentTagline'),
    currentApparent: $('currentApparent'),
    statHumidity: $('statHumidity'),
    statWind: $('statWind'),
    statWindDir: $('statWindDir'),
    statPressure: $('statPressure'),
    indoorTemp: $('indoorTemp'),
    offlineBadge: $('offlineBadge'),
    toast: $('toast'),
    installGuide: $('installGuide'),
    installGuideLead: $('installGuideLead'),
    installGuideSteps: $('installGuideSteps'),
    installGuideTitle: $('installGuideTitle'),
    btnInstallHelp: $('btnInstallHelp'),
    installGuideClose: $('installGuideClose'),
  };

  let deferredPrompt = null;
  let toastTimer = null;

  function showToast(msg, ms = 3200) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, ms);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function getIndoor() {
    const v = localStorage.getItem(INDOOR_KEY);
    const n = v != null ? parseFloat(v) : 22;
    return Number.isFinite(n) ? Math.round(n) : 22;
  }

  function setIndoor(n) {
    if (!Number.isFinite(n)) return;
    localStorage.setItem(INDOOR_KEY, String(Math.round(n)));
    els.indoorTemp.textContent = `${Math.round(n)}°`;
  }

  function formatTempMain(n) {
    const x = Math.round(n * 10) / 10;
    const absStr = String(x).replace('.', ',');
    const sign = x > 0 ? '+' : '';
    return `${sign}${absStr}°C`;
  }

  function formatMinLine(n) {
    const x = Math.round(n * 10) / 10;
    const s = String(x).replace('.', ',');
    if (x > 0) return `+${s}°C`;
    return `${s}°C`;
  }

  function windDirIt(deg) {
    if (deg == null || Number.isNaN(deg)) return '—';
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    const i = Math.round(deg / 45) % 8;
    return dirs[i];
  }

  function getFlameSvg() {
    return (
      '<svg class="hero__flame" viewBox="0 0 64 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<defs><linearGradient id="flameGrad" x1="0%" y1="100%" x2="0%" y2="0%">' +
      '<stop offset="0%" stop-color="#ffcc33"/><stop offset="45%" stop-color="#ff6b1a"/><stop offset="100%" stop-color="#c41e2a"/>' +
      '</linearGradient></defs>' +
      '<path fill="url(#flameGrad)" d="M32 4c-4 18-18 22-18 38 0 12 8 22 18 26 10-4 18-14 18-26 0-16-14-20-18-38zm0 18c2 10 10 14 10 24 0 8-4 14-10 18-6-4-10-10-10-18 0-10 8-14 10-24z"/>' +
      '</svg>'
    );
  }

  function wmoIt(code) {
    const map = {
      0: { desc: 'Sereno', icon: '☀️', preferFlame: true },
      1: { desc: 'Prevalentemente sereno', icon: '🌤️', preferFlame: true },
      2: { desc: 'Parzialmente nuvoloso', icon: '⛅', preferFlame: false },
      3: { desc: 'Nuvoloso', icon: '☁️', preferFlame: false },
      45: { desc: 'Nebbia', icon: '🌫️', preferFlame: false },
      48: { desc: 'Nebbia con brina', icon: '🌫️', preferFlame: false },
      51: { desc: 'Pioggerella leggera', icon: '🌦️', preferFlame: false },
      53: { desc: 'Pioggerella', icon: '🌦️', preferFlame: false },
      55: { desc: 'Pioggerella intensa', icon: '🌦️', preferFlame: false },
      56: { desc: 'Pioggerella gelata', icon: '🌨️', preferFlame: false },
      57: { desc: 'Pioggerella gelata intensa', icon: '🌨️', preferFlame: false },
      61: { desc: 'Pioggia leggera', icon: '🌧️', preferFlame: false },
      63: { desc: 'Pioggia', icon: '🌧️', preferFlame: false },
      65: { desc: 'Pioggia forte', icon: '⛈️', preferFlame: false },
      66: { desc: 'Pioggia gelata', icon: '🌨️', preferFlame: false },
      67: { desc: 'Pioggia gelata forte', icon: '🌨️', preferFlame: false },
      71: { desc: 'Neve leggera', icon: '❄️', preferFlame: false },
      73: { desc: 'Neve', icon: '❄️', preferFlame: false },
      75: { desc: 'Neve intensa', icon: '❄️', preferFlame: false },
      77: { desc: 'Granelli di neve', icon: '❄️', preferFlame: false },
      80: { desc: 'Rovesci leggeri', icon: '🌧️', preferFlame: false },
      81: { desc: 'Rovesci', icon: '🌧️', preferFlame: false },
      82: { desc: 'Rovesci violenti', icon: '⛈️', preferFlame: false },
      85: { desc: 'Rovesci di neve', icon: '🌨️', preferFlame: false },
      86: { desc: 'Forti rovesci di neve', icon: '🌨️', preferFlame: false },
      95: { desc: 'Temporale', icon: '⛈️', preferFlame: false },
      96: { desc: 'Temporale con grandine', icon: '⛈️', preferFlame: false },
      99: { desc: 'Temporale forte con grandine', icon: '⛈️', preferFlame: false },
    };
    return map[code] || { desc: 'Condizioni variabili', icon: '🌡️', preferFlame: false };
  }

  function weekdayLongUpper(isoDate) {
    const d = new Date(isoDate + 'T12:00:00');
    return d.toLocaleDateString('it-IT', { weekday: 'long' }).toUpperCase();
  }

  function updateLocationMeta() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('it-IT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    const timeStr = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    els.locationMeta.textContent = `${dateStr} · agg. ${timeStr}`;
  }

  function renderHeroIcon(code, desc) {
    const wrap = els.heroIconWrap;
    const w = wmoIt(code);
    wrap.setAttribute('aria-label', desc);
    if (w.preferFlame) {
      wrap.classList.add('hero__icon-wrap--flame');
      wrap.innerHTML = getFlameSvg();
    } else {
      wrap.classList.remove('hero__icon-wrap--flame');
      wrap.innerHTML = `<span class="hero__emoji">${w.icon}</span>`;
    }
  }

  async function geocode(name) {
    const q = encodeURIComponent(name.trim());
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=5&language=it&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Ricerca non disponibile');
    const data = await res.json();
    if (!data.results?.length) throw new Error('Località non trovata');
    const r = data.results[0];
    return {
      lat: r.latitude,
      lon: r.longitude,
      label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
      source: 'search',
    };
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocalizzazione non supportata'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            label: 'La tua posizione',
            source: 'geo',
          }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 60000 }
      );
    });
  }

  async function reverseLabel(lat, lon) {
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=it`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const r = data.results?.[0];
      if (!r) return null;
      return [r.name, r.admin1, r.country].filter(Boolean).join(', ');
    } catch {
      return null;
    }
  }

  async function fetchForecast(lat, lon) {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: [
        'temperature_2m',
        'relative_humidity_2m',
        'apparent_temperature',
        'weather_code',
        'wind_speed_10m',
        'wind_direction_10m',
        'surface_pressure',
      ].join(','),
      daily: [
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_sum',
        'wind_speed_10m_max',
      ].join(','),
      timezone: 'Europe/Rome',
      forecast_days: '5',
    });
    const url = `https://api.open-meteo.com/v1/forecast?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Meteo non disponibile');
    return res.json();
  }

  function taglineFromCurrent(cur, w) {
    const p0 = cur?.precip_hint;
    const parts = [
      `Percepita ${formatTempMain(cur.apparent_temperature)}`,
      `Umidità ${cur.relative_humidity_2m}%`,
    ];
    if (p0 != null && p0 > 2) parts.push('Pioggia prevista oggi');
    else if (w.desc.includes('Piogg') || w.desc.includes('Rovesci')) parts.push('Porta ombrello');
    return parts.join(' · ');
  }

  function render(data, place) {
    const cur = data.current;
    const w = wmoIt(cur.weather_code);

    els.locationName.textContent = place.label.split(',')[0] || place.label;
    updateLocationMeta();

    renderHeroIcon(cur.weather_code, w.desc);
    els.currentDesc.textContent = w.desc.toLowerCase();
    els.currentTemp.textContent = formatTempMain(cur.temperature_2m);

    const daily = data.daily;
    const pToday = daily?.precipitation_sum?.[0];
    const curWithHint = { ...cur, precip_hint: pToday };
    els.currentTagline.textContent = taglineFromCurrent(curWithHint, w);

    els.currentApparent.textContent = formatTempMain(cur.apparent_temperature);
    els.statHumidity.textContent = `${cur.relative_humidity_2m}%`;
    els.statWind.textContent = `${Math.round(cur.wind_speed_10m)} km/h`;
    els.statWindDir.textContent = windDirIt(cur.wind_direction_10m);
    els.statPressure.textContent = `${Math.round(cur.surface_pressure)} hPa`;

    els.indoorTemp.textContent = `${getIndoor()}°`;

    els.forecastList.innerHTML = '';
    for (let i = 0; i < daily.time.length; i++) {
      const code = daily.weather_code[i];
      const info = wmoIt(code);
      const col = document.createElement('div');
      col.className = 'forecast-col';
      col.innerHTML = `
        <div class="forecast-col__day">${weekdayLongUpper(daily.time[i])}</div>
        <div class="forecast-col__icon" role="img" aria-label="${info.desc}">${info.icon}</div>
        <div class="forecast-col__max">${Math.round(daily.temperature_2m_max[i])}°</div>
        <div class="forecast-col__min">${formatMinLine(daily.temperature_2m_min[i])}</div>
      `;
      els.forecastList.appendChild(col);
    }

    els.skeleton.hidden = true;
    els.contentLoaded.hidden = false;
  }

  async function load(place, { useCacheOnError } = {}) {
    els.offlineBadge.hidden = true;
    els.skeleton.hidden = false;
    els.contentLoaded.hidden = true;

    if (place.source === 'geo' && place.label === 'La tua posizione') {
      const rev = await reverseLabel(place.lat, place.lon);
      if (rev) place = { ...place, label: rev };
    }

    try {
      const forecast = await fetchForecast(place.lat, place.lon);
      saveState({ place, forecast, savedAt: Date.now() });
      render(forecast, place);
    } catch (e) {
      const state = loadState();
      if (useCacheOnError && state?.forecast && state?.place) {
        render(state.forecast, state.place);
        els.offlineBadge.hidden = false;
        showToast('Connessione assente: ultimi dati salvati.');
        return;
      }
      els.skeleton.hidden = true;
      showToast(e.message || 'Errore caricamento');
    }
  }

  els.searchForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = els.cityInput.value;
    if (!name.trim()) {
      showToast('Inserisci una città');
      return;
    }
    try {
      const place = await geocode(name);
      await load(place, { useCacheOnError: true });
    } catch (e) {
      showToast(e.message || 'Ricerca fallita');
    }
  });

  els.btnGeo.addEventListener('click', async () => {
    try {
      const place = await getPosition();
      await load(place, { useCacheOnError: true });
    } catch (e) {
      const msg =
        e.code === 1
          ? 'Permesso posizione negato'
          : e.code === 2 || e.code === 3
            ? 'Posizione non disponibile'
            : e.message || 'Geolocalizzazione fallita';
      showToast(msg);
    }
  });

  els.indoorTemp.addEventListener('dblclick', () => {
    const current = getIndoor();
    const input = window.prompt('Temperatura ambiente desiderata (°C)', String(current));
    if (input == null || input.trim() === '') return;
    const n = parseFloat(input.replace(',', '.'));
    if (!Number.isFinite(n) || n < 5 || n > 35) {
      showToast('Inserisci un valore tra 5 e 35');
      return;
    }
    setIndoor(n);
    showToast('Temperatura ambiente aggiornata');
  });

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function fillInstallGuideInsecure() {
    els.installGuideTitle.textContent = 'Perché il pulsante Installa non va';
    els.installGuideLead.textContent =
      'Stai aprendo il sito con un indirizzo tipo http://192.168… Il browser non lo considera “sicuro” come https://, quindi non attiva l’installazione PWA completa (service worker + prompt ufficiale). Non è un bug dell’app.';
    els.installGuideSteps.innerHTML = isIOS()
      ? '<li>Per una <strong>scorciatoia</strong>: <strong>Safari</strong> → pulsante <strong>Condividi</strong> → <strong>Aggiungi a Home</strong> (alcune funzioni offline potrebbero mancare).</li><li>Per l’installazione “vera”: carica il sito su un hosting con <strong>HTTPS</strong> (es. Netlify) e riapri quel link.</li>'
      : '<li>Per una <strong>scorciatoia</strong>: <strong>Chrome</strong> → menu <strong>⋮</strong> → <strong>Aggiungi a schermata Home</strong> / <strong>Installa app</strong> (se presente; su http spesso manca).</li><li>Per l’installazione “vera”: usa un URL <strong>https://…</strong> (Netlify, ngrok, ecc.).</li>';
  }

  function fillInstallGuideSecureNoPrompt() {
    els.installGuideTitle.textContent = 'Installare sul telefono';
    els.installGuideLead.textContent =
      'Il browser non ha ancora offerto il banner di installazione. Puoi aggiungere la scorciatoia dal menu.';
    els.installGuideSteps.innerHTML = isIOS()
      ? '<li><strong>Safari</strong> → <strong>Condividi</strong> → <strong>Aggiungi a Home</strong>.</li>'
      : '<li><strong>Chrome</strong> → menu <strong>⋮</strong> → <strong>Installa app</strong> o <strong>Aggiungi a schermata Home</strong>.</li>';
  }

  function openInstallGuide(mode) {
    if (mode === 'insecure') fillInstallGuideInsecure();
    else fillInstallGuideSecureNoPrompt();
    els.installGuide.hidden = false;
  }

  function closeInstallGuide() {
    els.installGuide.hidden = true;
  }

  els.btnInstallHelp.addEventListener('click', () => {
    if (window.isSecureContext) openInstallGuide('secure');
    else openInstallGuide('insecure');
  });

  els.installGuideClose.addEventListener('click', closeInstallGuide);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    els.btnInstall.hidden = false;
  });

  els.btnInstall.addEventListener('click', async () => {
    if (!deferredPrompt) {
      showToast(
        window.isSecureContext
          ? 'Usa il menu del browser (⋮) → Installa app, oppure tocca “Installa” in alto per la guida.'
          : 'Serve HTTPS. Tocca “Installa” in alto per le istruzioni.'
      );
      openInstallGuide(window.isSecureContext ? 'secure' : 'insecure');
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    els.btnInstall.hidden = true;
    if (outcome === 'dismissed') els.btnInstall.hidden = false;
  });

  if (!window.isSecureContext) {
    openInstallGuide('insecure');
  }

  function initCarousel() {
    const root = document.getElementById('carousel');
    if (!root) return;
    const slides = root.querySelectorAll('.carousel__slide');
    const dots = root.querySelectorAll('.carousel__dot');
    dots.forEach((dot) => {
      dot.addEventListener('click', () => {
        const go = +dot.dataset.go;
        slides.forEach((s, i) => {
          s.classList.toggle('carousel__slide--active', i === go);
        });
        dots.forEach((d, i) => {
          d.classList.toggle('carousel__dot--active', i === go);
          d.setAttribute('aria-selected', i === go ? 'true' : 'false');
        });
      });
    });
  }

  initCarousel();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  (async function init() {
    const state = loadState();
    const online = navigator.onLine;

    if (online && state?.place) {
      await load(state.place, { useCacheOnError: true });
    } else if (!online && state?.forecast && state?.place) {
      render(state.forecast, state.place);
      els.offlineBadge.hidden = false;
    } else if (online) {
      try {
        const place = await getPosition();
        await load(place, { useCacheOnError: true });
      } catch {
        els.skeleton.hidden = true;
        showToast('Cerca una città o attiva la posizione', 4000);
      }
    } else {
      els.skeleton.hidden = true;
      showToast('Serve una connessione per il primo avvio');
    }
  })();
})();
