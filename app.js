(function () {
  'use strict';

  const STORAGE_KEY = 'meteo-nordica-v1';
  const INDOOR_KEY = 'meteo-nordica-indoor';
  const HOUSE_KEY = 'meteo-nordica-house';
  const GEO_TIMEOUT_MS = 12000;
  const FUEL_DAYS = 30;
  const FORECAST_API_DAYS = 16;
  const FORECAST_UI_DAYS = 5;
  const FUEL_RANGE_SPREAD = 0.15;
  const PELLET_KWH_PER_KG = 4.8;
  const WOOD_KWH_PER_KG = 4.0;
  const COAL_KWH_PER_KG = 7.5;
  const COAL_BOILER_ETA = 0.75;
  const DAYS_PER_YEAR = 365;

  const CLASS_K_HDD = {
    A4: 0.006,
    A3: 0.01,
    A2: 0.014,
    A1: 0.018,
    B: 0.026,
    C: 0.036,
    D: 0.052,
    E: 0.068,
    F: 0.084,
    G: 0.104,
  };

  const DEFAULT_HOUSE = {
    m2: 90,
    classe: 'E',
    combustibile: 'pellet',
    percRiscaldato: 1,
    tempDesiderata: 22,
    rendimento: 0.88,
    fattore: 1,
  };

  let lastForecastData = null;

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
    offlineBadge: $('offlineBadge'),
    toast: $('toast'),
    installGuide: $('installGuide'),
    installGuideLead: $('installGuideLead'),
    installGuideSteps: $('installGuideSteps'),
    installGuideTitle: $('installGuideTitle'),
    btnInstallHelp: $('btnInstallHelp'),
    installGuideClose: $('installGuideClose'),
    btnSettings: $('btnSettings'),
    settingsPanel: $('settingsPanel'),
    settingsForm: $('settingsForm'),
    settingsClose: $('settingsClose'),
    houseM2: $('houseM2'),
    houseClass: $('houseClass'),
    houseTemp: $('houseTemp'),
    housePerc: $('housePerc'),
    housePercOut: $('housePercOut'),
    houseEta: $('houseEta'),
    houseEtaOut: $('houseEtaOut'),
    houseFactor: $('houseFactor'),
    houseFactorOut: $('houseFactorOut'),
    fuelEstimateMain: $('fuelEstimateMain'),
    fuelEstimateDetail: $('fuelEstimateDetail'),
    envBenefits: $('envBenefits'),
    envCoal: $('envCoal'),
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

  function syncIndoorTemp(n) {
    if (!Number.isFinite(n)) return;
    localStorage.setItem(INDOOR_KEY, String(Math.round(n)));
    const house = getHouseSettings();
    house.tempDesiderata = Math.round(n);
    saveHouseSettings(house);
  }

  function getHouseSettings() {
    try {
      const raw = localStorage.getItem(HOUSE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return { ...DEFAULT_HOUSE, ...parsed };
    } catch {
      return { ...DEFAULT_HOUSE };
    }
  }

  function saveHouseSettings(house) {
    try {
      localStorage.setItem(HOUSE_KEY, JSON.stringify(house));
    } catch (_) {}
  }

  function getClassK(classe) {
    return CLASS_K_HDD[classe] ?? CLASS_K_HDD.E;
  }

  function dailyMeanTemp(daily, index) {
    const mean = daily.temperature_2m_mean?.[index];
    if (mean != null && Number.isFinite(mean)) return mean;
    const max = daily.temperature_2m_max?.[index];
    const min = daily.temperature_2m_min?.[index];
    if (max != null && min != null) return (max + min) / 2;
    return null;
  }

  function build30DayMeanTemps(daily) {
    const fromApi = [];
    const len = daily.time?.length ?? 0;
    for (let i = 0; i < len; i++) {
      const t = dailyMeanTemp(daily, i);
      if (t != null) fromApi.push(t);
    }
    if (!fromApi.length) return [];

    const fillValue =
      fromApi.reduce((a, b) => a + b, 0) / fromApi.length;
    const temps = fromApi.slice();
    while (temps.length < FUEL_DAYS) {
      temps.push(fillValue);
    }
    return temps.slice(0, FUEL_DAYS);
  }

  function computeFuelEstimate(daily, house) {
    const m2 = Number(house.m2);
    if (!Number.isFinite(m2) || m2 < 20) {
      return { ok: false, reason: 'setup' };
    }

    const temps = build30DayMeanTemps(daily);
    if (!temps.length) return { ok: false, reason: 'weather' };

    const base = Number(house.tempDesiderata) || getIndoor();
    const k = getClassK(house.classe);
    const perc = Math.min(1, Math.max(0.5, Number(house.percRiscaldato) || 1));
    const factor = Math.min(1.2, Math.max(0.8, Number(house.fattore) || 1));
    const eta = Math.min(0.95, Math.max(0.5, Number(house.rendimento) || 0.85));
    const isPellet = house.combustibile !== 'legna';
    const kwhPerKg = isPellet ? PELLET_KWH_PER_KG : WOOD_KWH_PER_KG;

    let totalHdd = 0;
    let totalKwh = 0;
    temps.forEach((t) => {
      const hdd = Math.max(0, base - t);
      totalHdd += hdd;
      totalKwh += hdd * m2 * k * perc * factor;
    });

    if (totalHdd < 0.5) {
      return {
        ok: true,
        low: true,
        combustibile: isPellet ? 'pellet' : 'legna',
        kgMin: 0,
        kgMax: 0,
        sacchi: 0,
        totalKwh: 0,
        totalHdd: Math.round(totalHdd * 10) / 10,
        forecastDaysUsed: Math.min(FORECAST_API_DAYS, daily.time?.length ?? 0),
      };
    }

    const kgCenter = totalKwh / (kwhPerKg * eta);
    const kgMin = Math.max(0, Math.round(kgCenter * (1 - FUEL_RANGE_SPREAD)));
    const kgMax = Math.max(kgMin + 1, Math.round(kgCenter * (1 + FUEL_RANGE_SPREAD)));
    const sacchi = Math.ceil(kgCenter / 15);

    return {
      ok: true,
      low: false,
      combustibile: isPellet ? 'pellet' : 'legna',
      kgMin,
      kgMax,
      sacchi,
      totalKwh,
      totalHdd: Math.round(totalHdd * 10) / 10,
      forecastDaysUsed: Math.min(FORECAST_API_DAYS, daily.time?.length ?? 0),
    };
  }

  function formatTonnes(t) {
    if (!Number.isFinite(t) || t <= 0) return '—';
    if (t < 0.01) return '< 0,01 t';
    return `${t.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t`;
  }

  function computeEnvBenefits(totalKwh30d) {
    if (!Number.isFinite(totalKwh30d) || totalKwh30d <= 0) {
      return { ok: false };
    }
    const kwhAnnual = totalKwh30d * (DAYS_PER_YEAR / FUEL_DAYS);
    const kgCoal = kwhAnnual / (COAL_KWH_PER_KG * COAL_BOILER_ETA);
    const tCoal = kgCoal / 1000;
    return { ok: true, tCoal };
  }

  function renderEnvBenefits(fuelResult) {
    if (!els.envBenefits) return;
    if (!fuelResult?.ok || fuelResult.low || !fuelResult.totalKwh) {
      els.envBenefits.hidden = true;
      return;
    }
    const env = computeEnvBenefits(fuelResult.totalKwh);
    if (!env.ok) {
      els.envBenefits.hidden = true;
      return;
    }
    els.envBenefits.hidden = false;
    if (els.envCoal) els.envCoal.textContent = formatTonnes(env.tCoal);
  }

  function renderFuelEstimate(forecastData) {
    if (!els.fuelEstimateMain) return;
    const house = getHouseSettings();
    const result = computeFuelEstimate(forecastData.daily, house);

    if (!result.ok) {
      if (result.reason === 'setup') {
        els.fuelEstimateMain.textContent = 'Imposta la casa';
        els.fuelEstimateDetail.textContent = 'Tocca ⚙ e inserisci m² e classe energetica.';
      } else {
        els.fuelEstimateMain.textContent = 'Meteo non disponibile';
        els.fuelEstimateDetail.textContent = 'Riprova quando i dati sono caricati.';
      }
      renderEnvBenefits(null);
      return;
    }

    if (result.low) {
      els.fuelEstimateMain.textContent = 'Riscaldamento minimo';
      els.fuelEstimateDetail.textContent =
        'Nei prossimi 30 giorni il fabbisogno stimato è trascurabile.';
      renderEnvBenefits(result);
      return;
    }

    const label = result.combustibile === 'pellet' ? 'pellet' : 'legna';
    els.fuelEstimateMain.textContent = `≈ ${result.kgMin}–${result.kgMax} kg di ${label}`;
    if (result.combustibile === 'pellet') {
      els.fuelEstimateDetail.textContent = `Circa ${result.sacchi} sacchi da 15 kg (stima centrale).`;
    } else {
      const center = Math.round((result.kgMin + result.kgMax) / 2);
      els.fuelEstimateDetail.textContent = `Valore centrale indicativo: circa ${center} kg.`;
    }
    renderEnvBenefits(result);
  }

  function fillSettingsForm() {
    const h = getHouseSettings();
    els.houseM2.value = h.m2 ?? DEFAULT_HOUSE.m2;
    els.houseClass.value = h.classe ?? 'E';
    els.houseTemp.value = h.tempDesiderata ?? getIndoor();
    const perc = Math.round((h.percRiscaldato ?? 1) * 100);
    els.housePerc.value = String(perc);
    els.housePercOut.textContent = `${perc}%`;
    const etaPct = Math.round((h.rendimento ?? 0.88) * 100);
    els.houseEta.value = String(etaPct);
    els.houseEtaOut.textContent = `${etaPct}%`;
    const facPct = Math.round((h.fattore ?? 1) * 100);
    els.houseFactor.value = String(facPct);
    els.houseFactorOut.textContent = `${facPct}%`;
    const fuel = h.combustibile === 'legna' ? 'legna' : 'pellet';
    const radio = els.settingsForm.querySelector(`input[name="combustibile"][value="${fuel}"]`);
    if (radio) radio.checked = true;
  }

  function readSettingsForm() {
    const fuelInput = els.settingsForm.querySelector('input[name="combustibile"]:checked');
    return {
      m2: parseFloat(els.houseM2.value),
      classe: els.houseClass.value || 'E',
      combustibile: fuelInput?.value === 'legna' ? 'legna' : 'pellet',
      tempDesiderata: parseFloat(els.houseTemp.value),
      percRiscaldato: parseInt(els.housePerc.value, 10) / 100,
      rendimento: parseInt(els.houseEta.value, 10) / 100,
      fattore: parseInt(els.houseFactor.value, 10) / 100,
    };
  }

  function openSettings() {
    if (!els.settingsPanel) return;
    fillSettingsForm();
    els.settingsPanel.hidden = false;
    els.settingsPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeSettings() {
    if (els.settingsPanel) els.settingsPanel.hidden = true;
  }

  function refreshFuelFromCache() {
    const state = loadState();
    if (state?.forecast?.daily) {
      lastForecastData = state.forecast;
      renderFuelEstimate(state.forecast);
    }
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
        'temperature_2m_mean',
        'precipitation_sum',
        'wind_speed_10m_max',
      ].join(','),
      timezone: 'Europe/Rome',
      forecast_days: String(FORECAST_API_DAYS),
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

    lastForecastData = data;
    renderFuelEstimate(data);

    els.forecastList.innerHTML = '';
    const uiDays = Math.min(FORECAST_UI_DAYS, daily.time.length);
    for (let i = 0; i < uiDays; i++) {
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

  function bindSettingsOpen(el) {
    if (el) el.addEventListener('click', openSettings);
  }
  bindSettingsOpen(els.btnSettings);
  bindSettingsOpen(document.getElementById('btnSettingsAlt'));

  if (els.settingsClose) els.settingsClose.addEventListener('click', closeSettings);

  if (els.settingsForm) els.settingsForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const h = readSettingsForm();
    if (!Number.isFinite(h.m2) || h.m2 < 20) {
      showToast('Inserisci una superficie valida (min. 20 m²)');
      return;
    }
    saveHouseSettings(h);
    syncIndoorTemp(h.tempDesiderata);
    closeSettings();
    showToast('Impostazioni salvate');
    if (lastForecastData) renderFuelEstimate(lastForecastData);
  });

  ['housePerc', 'houseEta', 'houseFactor'].forEach((id) => {
    const input = els[id];
    const out = els[`${id}Out`];
    if (!input || !out) return;
    input.addEventListener('input', () => {
      out.textContent = `${input.value}%`;
    });
  });

  if (els.settingsForm) els.settingsForm.querySelectorAll('input[name="combustibile"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.value === 'legna' && radio.checked) {
        els.houseEta.value = '78';
        els.houseEtaOut.textContent = '78%';
      } else if (radio.value === 'pellet' && radio.checked) {
        els.houseEta.value = '88';
        els.houseEtaOut.textContent = '88%';
      }
    });
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

  if (!window.isSecureContext && !sessionStorage.getItem('meteo-install-hint-seen')) {
    openInstallGuide('insecure');
    sessionStorage.setItem('meteo-install-hint-seen', '1');
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
  saveHouseSettings(getHouseSettings());
  refreshFuelFromCache();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.update());
    });
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
