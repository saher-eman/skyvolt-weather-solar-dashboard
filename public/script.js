// ===== HELPER: decide sky-class from the weather description =====
function getSkyClass(description) {
  const desc = description.toLowerCase();
  if (desc.includes('clear')) return 'sky-clear';
  if (desc.includes('rain') || desc.includes('drizzle') || desc.includes('thunderstorm')) return 'sky-rain';
  if (desc.includes('snow')) return 'sky-snow';
  if (desc.includes('cloud')) return 'sky-clouds';
  return 'sky-clouds'; // default
}

function setStatus(message, isError = false) {
  const el = document.getElementById('status-msg');
  el.textContent = message;
  el.style.color = isError ? '#FFD2D2' : '#fff';
}

// ===== TEMPERATURE COLOR CODING =====
// Below 20°C -> blue, 20-30°C -> green, 30-39°C -> orange, 40°C+ -> red.
// Thresholds are always evaluated in °C, so we convert first if the user is on °F.
function tempColorClass(tempValue, unit) {
  if (typeof tempValue !== 'number' || isNaN(tempValue)) return '';
  const celsius = unit === 'imperial' ? (tempValue - 32) * 5 / 9 : tempValue;
  if (celsius < 20) return 'temp-blue';
  if (celsius < 30) return 'temp-green';
  if (celsius < 40) return 'temp-orange';
  return 'temp-red';
}

// A tiny in-memory cache so re-searching the same city/units within a short window
// doesn't hit the weather API again unnecessarily (Performance: avoid unneeded API calls).
const CACHE_TTL_MS = 60 * 1000;
const requestCache = new Map();
async function cachedFetchJSON(url) {
  const cached = requestCache.get(url);
  if (cached && (Date.now() - cached.time) < CACHE_TTL_MS) {
    return { ok: true, data: cached.data };
  }
  const response = await fetch(url);
  const data = await response.json();
  if (response.ok) requestCache.set(url, { time: Date.now(), data });
  return { ok: response.ok, data };
}

// ===== CURRENT WEATHER =====
async function loadWeather(city) {
  setStatus('Loading...');
  const card = document.getElementById('current-card');
  const errorCard = document.getElementById('error-card');
  card.classList.add('is-loading');
  lastSearchedCity = city; // used by the Retry button

  try {
    const { ok, data } = await cachedFetchJSON(`/weather?city=${encodeURIComponent(city)}`);

    if (!ok) {
      setStatus(data.error, true);
      card.classList.add('hidden');
      card.classList.remove('is-loading');
      // Only show the friendly error card for real connectivity/server failures,
      // not for a simple "city not found" typo (that's better handled inline via setStatus).
      if (data.error && !/city not found/i.test(data.error)) {
        errorCard.classList.remove('hidden');
      }
      return;
    }

    errorCard.classList.add('hidden');

    // Update the sky hero background
    const hero = document.getElementById('sky-hero');
    hero.className = getSkyClass(data.weather);

    // Fill in the current weather card
    document.getElementById('cw-city').textContent = `${data.city}, ${data.country}`;
    document.getElementById('cw-desc').textContent = data.weather;
    document.getElementById('cw-icon').textContent = data.icon || '🌡️';

    const tempEl = document.getElementById('cw-temp');
    tempEl.textContent = data.temperature;
    tempEl.className = `temp-readout ${tempColorClass(data.temperature_value, data.temperature_unit)}`;

    const feelsEl = document.getElementById('cw-feels');
    feelsEl.textContent = data.feels_like;
    feelsEl.className = `stat-value ${tempColorClass(data.feels_like_value, data.temperature_unit)}`;

    document.getElementById('cw-humidity').textContent = data.humidity;
    document.getElementById('cw-wind').textContent = data.wind_speed;
    document.getElementById('cw-pressure').textContent = data.pressure;

    // ----- UV Index (color badge + advice) -----
    document.getElementById('cw-uv').textContent = data.uv_index != null ? data.uv_index : '--';
    const uvBadge = document.getElementById('cw-uv-badge');
    uvBadge.textContent = data.uv_level || '--';
    uvBadge.className = `uv-badge uv-${data.uv_color || 'green'}`;
    const uvAdviceEl = document.getElementById('cw-uv-advice');
    if (uvAdviceEl) uvAdviceEl.textContent = data.uv_advice || '';

    document.getElementById('cw-visibility').textContent = data.visibility_km != null ? `${data.visibility_km} km` : '--';
    document.getElementById('cw-dewpoint').textContent = data.dew_point || '--';
    document.getElementById('cw-rain-chance').textContent = data.rain_probability != null ? `${data.rain_probability}%` : '--';

    document.getElementById('cw-sunrise').textContent = data.sunrise || '--';
    document.getElementById('cw-sunset').textContent = data.sunset || '--';
    document.getElementById('cw-moon').textContent = data.moon_icon ? `${data.moon_icon} ${data.moon_phase}` : '--';
    document.getElementById('cw-moon-label').textContent =
      data.moon_illumination != null ? `MOON PHASE (${data.moon_illumination}% lit)` : 'MOON PHASE';

    // ----- Air Quality (may be null if the AQI API was briefly unavailable) -----
    const aqiEl = document.getElementById('cw-aqi');
    const aqiBadge = document.getElementById('cw-aqi-badge');
    const aqiAdviceEl = document.getElementById('cw-aqi-advice');
    if (data.air_quality) {
      aqiEl.textContent = data.air_quality.value;
      aqiBadge.textContent = data.air_quality.level;
      aqiBadge.className = `aqi-badge aqi-${data.air_quality.color}`;
      if (aqiAdviceEl) aqiAdviceEl.textContent = data.air_quality.advice || '';
    } else {
      aqiEl.textContent = 'N/A';
      aqiBadge.textContent = '--';
      aqiBadge.className = 'aqi-badge';
      if (aqiAdviceEl) aqiAdviceEl.textContent = '';
    }

    // ----- Last updated -----
    if (data.last_updated) {
      const updatedDate = new Date(data.last_updated);
      document.getElementById('cw-last-updated').textContent =
        `Last updated: ${updatedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    card.classList.remove('hidden', 'is-loading');
    card.classList.remove('fade-in');
    void card.offsetWidth; // restart the fade-in animation on every new search
    card.classList.add('fade-in');

    document.getElementById('fav-btn').dataset.city = data.city;
    document.getElementById('fav-btn').disabled = false;
    document.getElementById('fav-btn').textContent = '+ Save to favorites';

    currentCity = data.city; // solar estimator will use this city's data

    // Hide the "search a city first" prompt now that a city is selected - it's no longer relevant
    const solarSubMessage = document.getElementById('solar-sub-message');
    if (solarSubMessage) solarSubMessage.classList.add('hidden');

    setStatus('');
    loadForecast(city);

  } catch (error) {
    setStatus('Something went wrong — please check the server', true);
    card.classList.remove('is-loading');
    card.classList.add('hidden');
    errorCard.classList.remove('hidden');
  }
}

// ===== FORECAST (daily + hourly) =====
async function loadForecast(city) {
  const strip = document.getElementById('forecast-strip');
  const hourlySection = document.getElementById('hourly-section');
  const hourlyStrip = document.getElementById('hourly-strip');

  // Loading skeletons while the request is in flight
  strip.innerHTML = Array(5).fill('<div class="forecast-day skeleton-card"></div>').join('');
  hourlyStrip.innerHTML = Array(6).fill('<div class="hourly-item skeleton-card"></div>').join('');
  hourlySection.classList.remove('hidden');

  try {
    const { ok, data } = await cachedFetchJSON(`/forecast?city=${encodeURIComponent(city)}`);

    if (!ok) {
      strip.innerHTML = `<p class="empty-note">${data.error}</p>`;
      hourlySection.classList.add('hidden');
      return;
    }

    strip.innerHTML = data.forecast.map(day => `
      <div class="forecast-day ${day.severe ? 'forecast-day-severe' : ''} fade-in">
        ${day.severe ? '<p class="severe-badge">⚠️ Severe</p>' : ''}
        <p class="forecast-date">${day.date.slice(5)}</p>
        <p class="forecast-icon weather-icon">${day.icon || '🌡️'}</p>
        <p class="forecast-temp"><span class="forecast-high">${day.high}</span> / <span class="forecast-low">${day.low}</span></p>
        <p class="forecast-desc">${day.weather}</p>
      </div>
    `).join('');

    // If any upcoming day has severe weather, show a banner noting solar estimates won't be reliable for it
    const severeDay = data.forecast.find(day => day.severe);
    const severeBanner = document.getElementById('severe-weather-banner');
    if (severeDay) {
      severeBanner.textContent =
        `⚠️ ${severeDay.weather} expected on ${severeDay.date.slice(5)} — solar output will be low and ` +
        `unpredictable that day, so today's estimate above won't carry over.`;
      severeBanner.classList.remove('hidden');
    } else {
      severeBanner.classList.add('hidden');
    }

    // Also fill in the hourly strip (next 24 hours)
    if (data.hourly && data.hourly.length > 0) {
      hourlyStrip.innerHTML = data.hourly.map(h => `
        <div class="hourly-item fade-in">
          <p class="hourly-time">${h.time}</p>
          <p class="hourly-icon weather-icon">${h.icon || '🌡️'}</p>
          <p class="hourly-temp">${h.temperature}</p>
          <p class="hourly-desc">${h.weather}</p>
        </div>
      `).join('');
      hourlySection.classList.remove('hidden');
    } else {
      hourlySection.classList.add('hidden');
    }

  } catch (error) {
    strip.innerHTML = `<p class="empty-note">Forecast failed to load</p>`;
    hourlySection.classList.add('hidden');
  }
}

// ===== COMPARE CITIES =====
async function loadCompare(citiesText) {
  const resultsEl = document.getElementById('compare-results');
  const noteEl = document.getElementById('compare-note');
  resultsEl.innerHTML = `<p class="empty-note">Loading...</p>`;

  try {
    const { data } = await cachedFetchJSON(`/compare?cities=${encodeURIComponent(citiesText)}`);

    const rows = data.comparison.map(item => {
      if (item.error) {
        return `<tr><td>${item.city}</td><td colspan="8" class="compare-error-cell">${item.error}</td></tr>`;
      }
      return `
        <tr>
          <td class="compare-city-cell">${item.icon || ''} ${item.city}</td>
          <td class="${item.is_highest_temp ? 'compare-highlight' : ''}">${item.temperature}</td>
          <td>${item.weather}</td>
          <td>${item.humidity}</td>
          <td>${item.wind_speed}</td>
          <td>${item.pressure}</td>
          <td>${item.uv_index != null ? `${item.uv_index} (${item.uv_level})` : '--'}</td>
          <td class="${item.is_best_air_quality ? 'compare-highlight' : ''}">${item.aqi != null ? `${item.aqi} (${item.aqi_level})` : 'N/A'}</td>
          <td class="${item.is_best_solar ? 'compare-highlight' : ''}">${item.solar_output_kwh != null ? `${item.solar_output_kwh} kWh` : '--'}</td>
          <td>${item.estimated_savings_rs != null ? `Rs ${item.estimated_savings_rs}` : '--'}</td>
        </tr>`;
    }).join('');

    resultsEl.innerHTML = `
      <table class="compare-table" aria-label="City weather comparison table">
        <thead>
          <tr>
            <th scope="col">City</th>
            <th scope="col">Temp</th>
            <th scope="col">Condition</th>
            <th scope="col">Humidity</th>
            <th scope="col">Wind</th>
            <th scope="col">Pressure</th>
            <th scope="col">UV</th>
            <th scope="col">AQI</th>
            <th scope="col">Solar Output</th>
            <th scope="col">Est. Savings</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    if (noteEl) {
      noteEl.textContent = data.assumption_note ||
        'Highlighted cells: highest temperature, best air quality, best solar output.';
    }

  } catch (error) {
    resultsEl.innerHTML = `<p class="empty-note">Comparison failed to load</p>`;
  }
}

// ===== FAVORITES =====
async function loadFavorites() {
  const listEl = document.getElementById('favorites-list');

  try {
    const response = await fetch('/favorites');
    const data = await response.json();

    if (!data.favorite_cities || data.favorite_cities.length === 0) {
      listEl.innerHTML = `<p class="empty-note">No favorites saved yet.</p>`;
      return;
    }

    listEl.innerHTML = data.favorite_cities.map(city => `
      <div class="favorite-row">
        <span>${city}</span>
      </div>
    `).join('');

  } catch (error) {
    listEl.innerHTML = `<p class="empty-note">Favorites failed to load</p>`;
  }
}

async function addFavorite(city) {
  const btn = document.getElementById('fav-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const response = await fetch('/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city })
    });
    const data = await response.json();

    if (response.ok) {
      btn.textContent = 'Saved ✓';
      loadFavorites();
    } else {
      btn.textContent = data.error;
      btn.disabled = false;
    }
  } catch (error) {
    btn.textContent = 'Save failed';
    btn.disabled = false;
  }
}

// ===== SOLAR ESTIMATOR (Phase 2 - unique feature) =====
let currentCity = null; // the city that was last searched; solar calculation runs on this city
let lastSearchedCity = null; // used by the error card's Retry button

const MAX_PANELS = 50; // cap so we don't generate too many wattage fields

const sameWattageField = document.getElementById('same-wattage-field');
const wattageFieldsContainer = document.getElementById('wattage-fields');

// Toggle between "all panels same wattage" and "panels have different wattage"
document.querySelectorAll('input[name="wattage-mode"]').forEach((radio) => {
  radio.addEventListener('change', (e) => {
    const mode = e.target.value;
    if (mode === 'same') {
      sameWattageField.classList.remove('hidden');
      wattageFieldsContainer.classList.add('hidden');
    } else {
      sameWattageField.classList.add('hidden');
      wattageFieldsContainer.classList.remove('hidden');
      rebuildDifferentWattageFields();
    }
  });
});

// When panel count changes and "different wattage" mode is active, rebuild the per-panel inputs
document.getElementById('panel-count').addEventListener('input', () => {
  const mode = document.querySelector('input[name="wattage-mode"]:checked').value;
  if (mode === 'different') rebuildDifferentWattageFields();
});

function rebuildDifferentWattageFields() {
  const count = parseInt(document.getElementById('panel-count').value, 10);
  wattageFieldsContainer.innerHTML = '';

  if (!count || count < 1) return;

  const total = Math.min(count, MAX_PANELS);

  for (let i = 1; i <= total; i++) {
    const field = document.createElement('div');
    field.className = 'solar-field wattage-field';
    field.innerHTML = `
      <label>Panel ${i} wattage (W)</label>
      <input type="number" class="panel-wattage-input" min="1" placeholder="e.g. 300" required>
    `;
    wattageFieldsContainer.appendChild(field);
  }

  if (count > MAX_PANELS) {
    const note = document.createElement('p');
    note.className = 'empty-note';
    note.textContent = `Only the first ${MAX_PANELS} panels' wattage will be used.`;
    wattageFieldsContainer.appendChild(note);
  }
}

// Confidence -> a CSS class so the UI can color-code high/medium/low confidence
function confidenceClass(confidence) {
  if (confidence === 'High') return 'confidence-high';
  if (confidence === 'Medium-High') return 'confidence-medium-high';
  if (confidence === 'Medium') return 'confidence-medium';
  return 'confidence-low';
}

async function loadSolar(city, wattages, rate, rateWasEmpty) {
  const resultsEl = document.getElementById('solar-results');
  const form = document.getElementById('solar-form');
  const submitBtn = form.querySelector('button');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Calculating...';

  try {
    const wattagesParam = wattages.join(',');
    const response = await fetch(`/solar?city=${encodeURIComponent(city)}&wattages=${encodeURIComponent(wattagesParam)}&rate=${encodeURIComponent(rate)}`);
    const data = await response.json();

    if (!response.ok) {
      alert(data.error);
      return;
    }

    // ----- Output: single value when confidence is High, range otherwise -----
    // Heading is fully dynamic - it reflects the LIVE current weather condition from the server
    // (e.g. "☀️ CLEAR SKY — ESTIMATED OUTPUT", "⛈️ THUNDERSTORM — ESTIMATED OUTPUT"), never hardcoded.
    document.getElementById('solar-condition-label').textContent =
      data.solar_heading || `${data.sky_condition_label.toUpperCase()} — ESTIMATED OUTPUT`;
    document.getElementById('solar-output').textContent = data.show_range
      ? `${data.output_range_kwh.low} – ${data.output_range_kwh.high} kWh`
      : `${data.output_single_kwh} kWh`;
    document.getElementById('solar-output-sub').textContent =
      `System size: ${data.system_size_kw} kW · Efficiency: ${data.efficiency_percent}%`;

    const confidenceEl = document.getElementById('solar-confidence');
    confidenceEl.textContent = `Confidence: ${data.confidence}`;
    confidenceEl.className = `solar-confidence ${confidenceClass(data.confidence)}`;

    const confidenceExplanationEl = document.getElementById('solar-confidence-explanation');
    if (confidenceExplanationEl) {
      confidenceExplanationEl.textContent = data.confidence_explanation || '';
    }

    // ----- Savings: matches whatever format the output above used -----
    document.getElementById('solar-savings').textContent = data.show_range
      ? `Rs ${data.savings_range_rs.low} – ${data.savings_range_rs.high}`
      : `Rs ${data.savings_single_rs}`;

    // Tell the user explicitly when their rate input was ignored and a default was used,
    // instead of silently substituting Rs 65 with no indication anything changed.
    const savingsSubEl = document.getElementById('solar-savings-sub');
    if (data.rate_was_defaulted && rateWasEmpty) {
      savingsSubEl.textContent = `No rate entered — using default Rs ${data.electricity_rate}/unit`;
      savingsSubEl.classList.add('rate-defaulted-note');
    } else {
      savingsSubEl.textContent = `Based on Rs ${data.electricity_rate}/unit`;
      savingsSubEl.classList.remove('rate-defaulted-note');
    }

    // ----- Other stats -----
    document.getElementById('solar-daylight').textContent = `${data.daylight_hours} hours`;
    document.getElementById('solar-peaksun').textContent = `${data.peak_sun_hours} hours`;
    document.getElementById('solar-peak').textContent = data.peak_solar_hours;
    document.getElementById('solar-drying').textContent = data.laundry_drying_speed;

    // ----- AC advice: correct units (kW = power, kWh = energy) and a single, clear, reusable
    // explanation of what "energy-equivalent hours" means vs actual runtime.
    // Defensive: if the server's precomputed ac_energy_equivalent_* fields are ever missing (e.g.
    // an older server.js still running), recompute the energy-equivalent hours client-side from
    // output_kwh / ac_ton_assumed rather than just showing a blank "--". -----
    function round1(n) {
      return Math.round(n * 10) / 10;
    }
    function resolveAcHours(precomputed, kwh) {
      if (typeof precomputed === 'number' && !isNaN(precomputed)) return precomputed;
      if (typeof kwh === 'number' && !isNaN(kwh) && data.ac_ton_assumed) return round1(kwh / data.ac_ton_assumed);
      return '--';
    }

    const energyEquivText = data.show_range
      ? `${resolveAcHours(data.ac_energy_equivalent_range && data.ac_energy_equivalent_range.low, data.output_range_kwh && data.output_range_kwh.low)}–${resolveAcHours(data.ac_energy_equivalent_range && data.ac_energy_equivalent_range.high, data.output_range_kwh && data.output_range_kwh.high)}`
      : `${resolveAcHours(data.ac_energy_equivalent_single, data.output_single_kwh)}`;

    document.getElementById('solar-ac').innerHTML =
      `<strong>Estimated solar energy:</strong> ${data.show_range ? `${data.output_range_kwh.low}–${data.output_range_kwh.high}` : data.output_single_kwh} kWh today.<br>` +
      `<strong>Approximate AC Runtime:</strong> ${energyEquivText} hours<br>` +
      `<span class="ac-note">Actual runtime depends on: Inverter vs Non-Inverter AC, indoor temperature, insulation, ` +
      `compressor cycling, and other appliances running.</span><br>` +
      `<strong>Battery / net metering note:</strong> without a battery or a net-metering agreement, this energy can ` +
      `only be used while the sun is up — it does not carry over to run the AC at night.`;

    document.getElementById('solar-tips-list').innerHTML = data.tips
      .map(tip => `<li>${tip}</li>`)
      .join('');

    resultsEl.classList.remove('hidden');
    resultsEl.classList.remove('fade-in');
    void resultsEl.offsetWidth;
    resultsEl.classList.add('fade-in');

  } catch (error) {
    alert('Solar calculation failed — please try again');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Calculate solar output';
  }
}

document.getElementById('solar-form').addEventListener('submit', (e) => {
  e.preventDefault();

  if (!currentCity) {
    alert('Please search a city above first, then calculate solar output.');
    return;
  }

  const mode = document.querySelector('input[name="wattage-mode"]:checked').value;
  let wattages = [];

  if (mode === 'same') {
    const panelCount = parseInt(document.getElementById('panel-count').value, 10);
    const wattagePerPanel = parseFloat(document.getElementById('same-wattage-input').value);

    if (!panelCount || panelCount < 1 || !wattagePerPanel || wattagePerPanel <= 0) {
      alert('Please enter the number of panels and the wattage per panel.');
      return;
    }

    wattages = Array(Math.min(panelCount, MAX_PANELS)).fill(wattagePerPanel);
  } else {
    const wattageInputs = document.querySelectorAll('.panel-wattage-input');
    wattages = Array.from(wattageInputs)
      .map(input => parseFloat(input.value))
      .filter(w => w > 0);

    if (wattages.length === 0) {
      alert('Please enter the number of panels and fill in each panel\'s wattage.');
      return;
    }
  }

  const rateInputRaw = document.getElementById('rate-input').value;
  const rateInput = parseFloat(rateInputRaw);
  const rateWasEmpty = !(rateInput > 0); // true if field was blank, zero, negative, or non-numeric
  const rate = rateWasEmpty ? 65 : rateInput;

  loadSolar(currentCity, wattages, rate, rateWasEmpty);
});

// ===== EVENT LISTENERS =====
document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const city = document.getElementById('city-input').value.trim();
  if (city) loadWeather(city);
});

document.getElementById('compare-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const cities = document.getElementById('compare-input').value.trim();
  if (cities) loadCompare(cities);
});

document.getElementById('fav-btn').addEventListener('click', () => {
  const city = document.getElementById('fav-btn').dataset.city;
  if (city) addFavorite(city);
});

document.getElementById('retry-btn').addEventListener('click', () => {
  if (lastSearchedCity) loadWeather(lastSearchedCity);
});

// Show favorites as soon as the page loads
loadFavorites();