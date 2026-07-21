const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.json()); // parses JSON bodies for POST requests

// Serve frontend files (HTML/CSS/JS) from 'public', with caching disabled.
// FIX: browsers were aggressively caching script.js/index.html, so after updating the code,
// users kept seeing an old cached version (missing new fields, old wording, etc.) even after
// restarting the server. Setting these headers forces the browser to always fetch the latest copy.
app.use(express.static('public', {
  etag: false,
  lastModified: false,
  cacheControl: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));

const PORT = process.env.PORT || 3000;

// Favorites and history are saved in simple JSON files (no database needed)
const FAVORITES_FILE = './favorites.json';
const HISTORY_FILE = './history.json';

// Helper function - read data from a file, return an empty array if the file doesn't exist
function readJSONFile(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return []; // File not found or empty
  }
}

// Helper function - save data to a file
function writeJSONFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ============ WMO WEATHER CODE -> TEXT DESCRIPTION ============
// Open-Meteo returns numeric codes (e.g. 0, 61, 95...), we convert these into readable text
const WEATHER_CODES = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'depositing rime fog',
  51: 'light drizzle',
  53: 'moderate drizzle',
  55: 'dense drizzle',
  56: 'light freezing drizzle',
  57: 'dense freezing drizzle',
  61: 'slight rain',
  63: 'moderate rain',
  65: 'heavy rain',
  66: 'light freezing rain',
  67: 'heavy freezing rain',
  71: 'slight snow fall',
  73: 'moderate snow fall',
  75: 'heavy snow fall',
  77: 'snow grains',
  80: 'slight rain showers',
  81: 'moderate rain showers',
  82: 'violent rain showers',
  85: 'slight snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with slight hail',
  99: 'thunderstorm with heavy hail'
};

function weatherCodeToText(code) {
  return WEATHER_CODES[code] || 'unknown';
}

// ============ WEATHER CODE -> EMOJI ICON (shared by hourly, daily, and solar heading) ============
const WEATHER_ICONS = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌦️', 56: '🌦️', 57: '🌦️',
  61: '🌧️', 63: '🌧️', 65: '🌧️', 66: '🌧️', 67: '🌧️',
  71: '❄️', 73: '❄️', 75: '❄️', 77: '❄️',
  80: '🌦️', 81: '🌦️', 82: '🌧️',
  85: '❄️', 86: '❄️',
  95: '⛈️', 96: '⛈️', 99: '⛈️'
};
function weatherCodeToIcon(code) {
  return WEATHER_ICONS[code] || '🌡️';
}

// Short, punchy heading label per weather code — used for the dynamic Solar section heading
// (e.g. "☀️ CLEAR SKY", "⛅ PARTLY CLOUDY", "⛈️ THUNDERSTORM") instead of a hardcoded string.
const WEATHER_HEADING_LABELS = {
  0: 'CLEAR SKY', 1: 'MAINLY CLEAR', 2: 'PARTLY CLOUDY', 3: 'OVERCAST',
  45: 'FOGGY', 48: 'FOGGY',
  51: 'DRIZZLE', 53: 'DRIZZLE', 55: 'DRIZZLE', 56: 'DRIZZLE', 57: 'DRIZZLE',
  61: 'RAINY', 63: 'RAINY', 65: 'RAINY', 66: 'RAINY', 67: 'RAINY',
  71: 'SNOWY', 73: 'SNOWY', 75: 'SNOWY', 77: 'SNOWY',
  80: 'SHOWERS', 81: 'SHOWERS', 82: 'RAINY',
  85: 'SNOWY', 86: 'SNOWY',
  95: 'THUNDERSTORM', 96: 'THUNDERSTORM', 99: 'THUNDERSTORM'
};
function weatherCodeToHeading(code) {
  const icon = weatherCodeToIcon(code);
  const label = WEATHER_HEADING_LABELS[code] || "TODAY'S";
  return icon + ' ' + label;
}

// ============ MOON PHASE (simple astronomical approximation, no external API needed) ============
// Based on days since a known new moon reference date, divided by the synodic month length (~29.53 days).
const MOON_PHASES = [
  { name: 'New Moon', icon: '🌑' },
  { name: 'Waxing Crescent', icon: '🌒' },
  { name: 'First Quarter', icon: '🌓' },
  { name: 'Waxing Gibbous', icon: '🌔' },
  { name: 'Full Moon', icon: '🌕' },
  { name: 'Waning Gibbous', icon: '🌖' },
  { name: 'Last Quarter', icon: '🌗' },
  { name: 'Waning Crescent', icon: '🌘' }
];
function getMoonPhase(date) {
  const knownNewMoon = new Date('2000-01-06T18:14:00Z').getTime(); // a known new moon reference point
  const synodicMonthMs = 29.530588 * 24 * 60 * 60 * 1000;
  const diff = date.getTime() - knownNewMoon;
  const phaseFraction = ((diff % synodicMonthMs) / synodicMonthMs + 1) % 1; // 0 = new moon, 0.5 = full moon
  const index = Math.floor(phaseFraction * 8) % 8;
  const illumination = Math.round((1 - Math.cos(phaseFraction * 2 * Math.PI)) / 2 * 100); // % illuminated
  return { ...MOON_PHASES[index], illumination };
}

// ============ UV INDEX CLASSIFICATION (standard WHO scale) ============
function classifyUV(uv) {
  if (uv >= 11) return { level: 'Extreme', color: 'purple' };
  if (uv >= 8) return { level: 'Very High', color: 'red' };
  if (uv >= 6) return { level: 'High', color: 'orange' };
  if (uv >= 3) return { level: 'Moderate', color: 'yellow' };
  return { level: 'Low', color: 'green' };
}

const UV_ADVICE = {
  'Low': 'No protection needed.',
  'Moderate': 'Wear sunglasses.',
  'High': 'Use sunscreen SPF30+.',
  'Very High': 'Avoid direct sunlight between 11 AM and 3 PM.',
  'Extreme': 'Stay indoors if possible.'
};
function getUvAdvice(level) {
  return UV_ADVICE[level] || '';
}

// ============ US AQI CLASSIFICATION (standard EPA scale) ============
function classifyAQI(aqi) {
  if (aqi > 300) return { level: 'Hazardous', color: 'maroon' };
  if (aqi > 200) return { level: 'Very Unhealthy', color: 'purple' };
  if (aqi > 150) return { level: 'Unhealthy', color: 'red' };
  if (aqi > 100) return { level: 'Unhealthy for Sensitive Groups', color: 'orange' };
  if (aqi > 50) return { level: 'Moderate', color: 'yellow' };
  return { level: 'Good', color: 'green' };
}
function getAqiAdvice(aqi) {
  if (aqi > 150) return 'Everyone should reduce outdoor exposure.';
  if (aqi > 100) return 'Sensitive groups should limit prolonged outdoor activity.';
  if (aqi > 50) return 'Air quality is acceptable.';
  return 'Air quality is excellent.';
}

// ============ HELPER: FORMAT AN ISO LOCAL TIME STRING AS 12-HOUR AM/PM ============
function formatHour(isoString) {
  const hourPart = isoString.split('T')[1];
  let [hours, mins] = hourPart.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${mins.toString().padStart(2, '0')} ${period}`;
}

// ============ HELPER: CONVERT CITY NAME TO COORDINATES (GEOCODING) ============
// The Open-Meteo weather API only accepts lat/long, not a city name - so we first
// need to convert the name to coordinates using the geocoding API
async function getCoordinates(city) {
  const response = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
    timeout: 10000, // fail fast instead of hanging forever if the geocoding API doesn't respond
    params: { name: city, count: 1, language: 'en', format: 'json' }
  });

  if (!response.data.results || response.data.results.length === 0) {
    return null; // City not found
  }

  const place = response.data.results[0];
  return {
    name: place.name,
    country: place.country_code,
    latitude: place.latitude,
    longitude: place.longitude
  };
}

// ============ CURRENT WEATHER ============
app.get('/weather', async (req, res) => {
  const city = req.query.city ? req.query.city.trim() : '';
  const units = req.query.units === 'imperial' ? 'imperial' : 'metric';
  const unitSymbol = units === 'imperial' ? '°F' : '°C';
  const speedUnit = units === 'imperial' ? 'mph' : 'm/s';
  const tempUnitParam = units === 'imperial' ? 'fahrenheit' : 'celsius';
  const windUnitParam = units === 'imperial' ? 'mph' : 'ms';

  if (!city) {
    return res.status(400).json({ error: 'Please enter a city name! Example: /weather?city=Karachi' });
  }

  try {
    const place = await getCoordinates(city);
    if (!place) {
      return res.status(404).json({ error: 'City not found — please check the spelling' });
    }

    const response = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: place.latitude,
        longitude: place.longitude,
        current: 'temperature_2m,apparent_temperature,relative_humidity_2m,pressure_msl,wind_speed_10m,weather_code,dew_point_2m',
        hourly: 'uv_index,visibility,precipitation_probability',
        daily: 'sunrise,sunset,uv_index_max,precipitation_probability_max',
        temperature_unit: tempUnitParam,
        wind_speed_unit: windUnitParam,
        timezone: 'auto', // Open-Meteo automatically uses the city's local time - no manual conversion needed
        forecast_days: 1
      }
    });

    const d = response.data;
    const c = d.current;

    // Find the hourly entry matching the current hour, for UV/visibility/rain-probability "right now"
    const currentHourStr = c.time.slice(0, 13); // e.g. "2026-07-20T14"
    let currentHourIndex = d.hourly.time.findIndex(t => t.startsWith(currentHourStr));
    if (currentHourIndex === -1) currentHourIndex = 0;

    const uvNow = d.hourly.uv_index[currentHourIndex];
    const visibilityMeters = d.hourly.visibility[currentHourIndex];
    const rainProbabilityNow = d.hourly.precipitation_probability[currentHourIndex];
    const uvClass = classifyUV(uvNow);

    // ===== AIR QUALITY (separate Open-Meteo Air Quality API) =====
    let aqiData = null;
    try {
      const aqiResponse = await axios.get('https://air-quality-api.open-meteo.com/v1/air-quality', {
        timeout: 8000,
        params: {
          latitude: place.latitude,
          longitude: place.longitude,
          current: 'us_aqi,pm2_5,pm10',
          timezone: 'auto'
        }
      });
      const aqiValue = aqiResponse.data.current.us_aqi;
      aqiData = {
        value: aqiValue,
        level: classifyAQI(aqiValue).level,
        color: classifyAQI(aqiValue).color,
        advice: getAqiAdvice(aqiValue),
        pm2_5: aqiResponse.data.current.pm2_5,
        pm10: aqiResponse.data.current.pm10
      };
    } catch (aqiError) {
      // Air quality is a "nice to have" - if that API is briefly unavailable, don't fail the whole weather request
      aqiData = null;
    }

    const moonPhase = getMoonPhase(new Date());

    // Save to search history
    const history = readJSONFile(HISTORY_FILE);
    history.unshift({ city: place.name, time: new Date().toLocaleString() }); // newest search goes on top
    writeJSONFile(HISTORY_FILE, history.slice(0, 5)); // keep only the last 5

    res.json({
      city: place.name,
      country: place.country,
      temperature: `${c.temperature_2m}${unitSymbol}`,
      temperature_value: c.temperature_2m,   // raw number, used client-side for temperature color-coding
      temperature_unit: units,               // 'metric' or 'imperial' - color thresholds are defined in °C
      feels_like: `${c.apparent_temperature}${unitSymbol}`,
      feels_like_value: c.apparent_temperature,
      humidity: `${c.relative_humidity_2m}%`,
      pressure: `${c.pressure_msl} hPa`,
      wind_speed: `${c.wind_speed_10m} ${speedUnit}`,
      weather: weatherCodeToText(c.weather_code),
      icon: weatherCodeToIcon(c.weather_code),
      dew_point: `${c.dew_point_2m}${unitSymbol}`,
      uv_index: uvNow,
      uv_level: uvClass.level,
      uv_color: uvClass.color,
      uv_advice: getUvAdvice(uvClass.level),
      uv_index_max_today: d.daily.uv_index_max[0],
      visibility_km: Math.round((visibilityMeters / 1000) * 10) / 10,
      rain_probability: rainProbabilityNow,
      sunrise: formatHour(d.daily.sunrise[0]),
      sunset: formatHour(d.daily.sunset[0]),
      moon_phase: moonPhase.name,
      moon_icon: moonPhase.icon,
      moon_illumination: moonPhase.illumination,
      air_quality: aqiData,
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    handleWeatherError(error, res);
  }
});

// ============ 5-DAY FORECAST (+ HOURLY) ============
app.get('/forecast', async (req, res) => {
  const city = req.query.city ? req.query.city.trim() : '';
  const units = req.query.units === 'imperial' ? 'imperial' : 'metric';
  const unitSymbol = units === 'imperial' ? '°F' : '°C';
  const tempUnitParam = units === 'imperial' ? 'fahrenheit' : 'celsius';

  if (!city) {
    return res.status(400).json({ error: 'Please enter a city name! Example: /forecast?city=Karachi' });
  }

  try {
    const place = await getCoordinates(city);
    if (!place) {
      return res.status(404).json({ error: 'City not found — please check the spelling' });
    }

    const response = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: place.latitude,
        longitude: place.longitude,
        current: 'weather_code', // live right-now condition, used to keep day-1 of the forecast in sync with Current Weather
        hourly: 'temperature_2m,weather_code',
        daily: 'temperature_2m_max,temperature_2m_min,weather_code',
        temperature_unit: tempUnitParam,
        timezone: 'auto', // local time comes automatically, no manual calculation needed
        forecast_days: 5,
        forecast_hours: 24 // only need the next 24 hours of hourly data
      }
    });

    const d = response.data;

    // ===== SEVERE WEATHER DETECTION (for warning banners on the forecast strip) =====
    // WMO codes: 95-99 = thunderstorm (incl. with hail), 65 = heavy rain, 75 = heavy snow, 82 = violent rain showers
    const SEVERE_WEATHER_CODES = [65, 75, 82, 95, 96, 99];
    function isSevereWeather(code) {
      return SEVERE_WEATHER_CODES.includes(code);
    }

    // ===== SYNC FIX: Current Weather and the 5-Day Forecast must never contradict each other =====
    // d.daily.weather_code[0] is a summary code for the *whole* day, while d.current.weather_code is
    // the live, right-now condition — these can legitimately differ (e.g. clear now, rain expected
    // later this afternoon). To avoid a confusing mismatch on-screen, day 1 of the forecast strip
    // uses the same live "current" code as the Current Weather card whenever day 1 is today.
    const todayDateStr = d.current && d.current.time ? d.current.time.split('T')[0] : null;
    const dailyWeatherCodes = d.daily.weather_code.slice();
    if (todayDateStr && d.daily.time[0] === todayDateStr && d.current) {
      dailyWeatherCodes[0] = d.current.weather_code;
    }

    // ===== DAILY FORECAST (5 din) =====
    const dailyForecast = d.daily.time.map((date, i) => ({
      date: date,
      high: `${d.daily.temperature_2m_max[i]}${unitSymbol}`,
      low: `${d.daily.temperature_2m_min[i]}${unitSymbol}`,
      temperature: `${d.daily.temperature_2m_max[i]}${unitSymbol}`, // kept for backwards compatibility
      weather: weatherCodeToText(dailyWeatherCodes[i]),
      icon: weatherCodeToIcon(dailyWeatherCodes[i]),
      severe: isSevereWeather(dailyWeatherCodes[i]) // true for thunderstorm/hail/heavy rain/heavy snow days
    }));

    // ===== HOURLY FORECAST (next 24 hours, real hour-by-hour data) =====
    // Open-Meteo time is already in local time due to the "auto" timezone (ISO format: 2026-06-26T15:00)
    // so we just extract the time from the string and convert to 12-hour AM/PM format - no manual offset math
    function formatHour(isoString) {
      const hourPart = isoString.split('T')[1]; // e.g. "15:00"
      let [hours, mins] = hourPart.split(':').map(Number);
      const period = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      if (hours === 0) hours = 12;
      return `${hours}:${mins.toString().padStart(2, '0')} ${period}`;
    }

    const hourlyForecast = d.hourly.time.map((time, i) => ({
      time: formatHour(time),
      temperature: `${d.hourly.temperature_2m[i]}${unitSymbol}`,
      weather: weatherCodeToText(d.hourly.weather_code[i]),
      icon: weatherCodeToIcon(d.hourly.weather_code[i])
    }));

    res.json({
      city: place.name,
      country: place.country,
      forecast: dailyForecast,
      hourly: hourlyForecast
    });

  } catch (error) {
    handleWeatherError(error, res);
  }
});

// ============ COMPARE MULTIPLE CITIES ============
// Standard assumption used only for the Compare Cities table, since that endpoint doesn't take a
// panel count from the user like /solar does — a typical small home system (10 x 300W = 3kW).
const COMPARE_ASSUMED_PANELS = 10;
const COMPARE_ASSUMED_WATTAGE_PER_PANEL = 300;

app.get('/compare', async (req, res) => {
  const citiesParam = req.query.cities ? req.query.cities.trim() : '';

  if (!citiesParam) {
    return res.status(400).json({ error: 'Please enter cities separated by commas! Example: /compare?cities=Karachi,Lahore' });
  }

  const cityList = citiesParam.split(',').map(c => c.trim()).filter(c => c.length > 0);

  try {
    // Fetching all cities' data at once (in parallel) — much faster
    const requests = cityList.map(async (city) => {
      try {
        const place = await getCoordinates(city);
        if (!place) return null;

        const [weatherResponse, aqiResponse] = await Promise.all([
          axios.get('https://api.open-meteo.com/v1/forecast', {
            timeout: 10000,
            params: {
              latitude: place.latitude,
              longitude: place.longitude,
              current: 'temperature_2m,relative_humidity_2m,pressure_msl,wind_speed_10m,weather_code',
              hourly: 'uv_index,shortwave_radiation',
              timezone: 'auto',
              forecast_days: 1
            }
          }),
          axios.get('https://air-quality-api.open-meteo.com/v1/air-quality', {
            timeout: 8000,
            params: { latitude: place.latitude, longitude: place.longitude, current: 'us_aqi', timezone: 'auto' }
          }).catch(() => null) // AQI is a "nice to have" - don't fail the whole comparison if it's briefly down
        ]);

        const c = weatherResponse.data.current;
        const currentHourStr = c.time.slice(0, 13);
        let hourIndex = weatherResponse.data.hourly.time.findIndex(t => t.startsWith(currentHourStr));
        if (hourIndex === -1) hourIndex = 0;
        const uvNow = weatherResponse.data.hourly.uv_index[hourIndex];

        // Rough solar estimate for the comparison table, using the same Peak-Sun-Hours formula as /solar
        const todayRadiation = weatherResponse.data.hourly.shortwave_radiation.slice(0, 24);
        const peakSunHours = todayRadiation.reduce((s, v) => s + (v || 0), 0) / 1000;
        const systemSizeKw = (COMPARE_ASSUMED_PANELS * COMPARE_ASSUMED_WATTAGE_PER_PANEL) / 1000;
        const estSolarKwh = systemSizeKw * peakSunHours * SOLAR_EFFICIENCY;
        const estSavingsRs = estSolarKwh * ELECTRICITY_RATE_DEFAULT;

        const aqiValue = aqiResponse ? aqiResponse.data.current.us_aqi : null;

        return {
          name: place.name,
          temperature: c.temperature_2m,
          humidity: c.relative_humidity_2m,
          wind_speed: c.wind_speed_10m,
          pressure: c.pressure_msl,
          weather: weatherCodeToText(c.weather_code),
          icon: weatherCodeToIcon(c.weather_code),
          uv_index: uvNow,
          uv_level: classifyUV(uvNow).level,
          aqi: aqiValue,
          aqi_level: aqiValue != null ? classifyAQI(aqiValue).level : null,
          solar_output_kwh: Math.round(estSolarKwh * 100) / 100,
          estimated_savings_rs: Math.round(estSavingsRs)
        };
      } catch {
        return null; // if one city is invalid, don't let it block the rest
      }
    });

    const responses = await Promise.all(requests);

    const results = responses.map((result, index) => {
      if (!result) {
        return { city: cityList[index], error: 'City not found' };
      }
      return {
        city: result.name,
        temperature: `${result.temperature}°C`,
        temperature_value: result.temperature,
        weather: result.weather,
        icon: result.icon,
        humidity: `${result.humidity}%`,
        wind_speed: `${result.wind_speed} m/s`,
        pressure: `${result.pressure} hPa`,
        uv_index: result.uv_index,
        uv_level: result.uv_level,
        aqi: result.aqi,
        aqi_level: result.aqi_level,
        solar_output_kwh: result.solar_output_kwh,
        estimated_savings_rs: result.estimated_savings_rs
      };
    });

    // ===== HIGHLIGHT FLAGS: which city wins on each headline metric (skips cities with errors) =====
    const validResults = results.filter(r => !r.error);
    if (validResults.length > 0) {
      const maxTemp = Math.max(...validResults.map(r => r.temperature_value));
      const maxSolar = Math.max(...validResults.map(r => r.solar_output_kwh ?? -Infinity));
      const aqiCandidates = validResults.filter(r => r.aqi != null);
      const minAqi = aqiCandidates.length ? Math.min(...aqiCandidates.map(r => r.aqi)) : null;

      results.forEach(r => {
        if (r.error) return;
        r.is_highest_temp = r.temperature_value === maxTemp;
        r.is_best_solar = r.solar_output_kwh === maxSolar;
        r.is_best_air_quality = minAqi != null && r.aqi === minAqi;
      });
    }

    res.json({
      comparison: results,
      assumption_note: `Solar estimates assume a standard ${COMPARE_ASSUMED_PANELS}x${COMPARE_ASSUMED_WATTAGE_PER_PANEL}W (${(COMPARE_ASSUMED_PANELS * COMPARE_ASSUMED_WATTAGE_PER_PANEL / 1000)}kW) system — use the Solar Estimator above for your actual panel count.`
    });

  } catch (error) {
    res.status(500).json({ error: 'Server error — please try again later' });
  }
});

// ============ SOLAR ESTIMATION (Phase 2 - unique feature) ============
// Solar industry formula:
// System Size (kW)   = Total Wattage / 1000
// Peak Sun Hours      = (sum of every hour's radiation today) / 1000   <- NOT daylight hours!
// Solar Output (kWh)  = System Size x Peak Sun Hours x Efficiency
const SOLAR_EFFICIENCY = 0.8; // real systems only deliver 75-85% due to heat, dust, inverter & wiring losses
const ELECTRICITY_RATE_DEFAULT = 65; // Rs per unit (kWh), used unless the user provides their own rate
const AC_TON_KW = 1.5; // average power draw of a 1.5 ton AC, used for the AC-support estimate below

// Classify today's sky condition from the daily weather code, so we know how wide the
// uncertainty range should be (clear days are predictable, rainy days are not).
function classifySkyCondition(code) {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly_cloudy';
  if (code === 3 || code === 45 || code === 48) return 'cloudy';
  return 'rainy'; // drizzle, rain, snow, thunderstorm codes
}

// Confidence range width depends on how predictable the sky is today.
// Clear sky -> tight range (high confidence). Rainy -> wide range (low confidence).
const RANGE_BY_CONDITION = {
  clear: { spread: 0.05, confidence: 'High', label: 'Clear sky today' },
  partly_cloudy: { spread: 0.10, confidence: 'Medium-High', label: 'Partly cloudy today' },
  cloudy: { spread: 0.175, confidence: 'Medium', label: 'Cloudy today' },
  rainy: { spread: 0.25, confidence: 'Low', label: 'Rainy/unsettled today' }
};

const CONFIDENCE_EXPLANATIONS = {
  'High': 'Stable clear-sky conditions make today\'s estimate highly reliable.',
  'Medium-High': 'Mostly clear with light cloud movement — today\'s estimate should be close to actual output.',
  'Medium': 'Some cloud movement may slightly affect production, widening the expected range.',
  'Low': 'Heavy cloud cover and changing weather make today\'s solar estimate less accurate.'
};

app.get('/solar', async (req, res) => {
  const city = req.query.city ? req.query.city.trim() : '';
  const wattagesParam = req.query.wattages ? req.query.wattages.trim() : '';
  const rateParam = parseFloat(req.query.rate);
  const electricityRate = (rateParam > 0) ? rateParam : ELECTRICITY_RATE_DEFAULT;

  if (!city) {
    return res.status(400).json({ error: 'Please enter a city name! Example: /solar?city=Lahore&wattages=300,300,250' });
  }

  // Split "300,300,250" into an array of numbers, drop invalid/empty values
  const wattages = wattagesParam
    .split(',')
    .map(w => parseFloat(w))
    .filter(w => w > 0);

  if (wattages.length === 0) {
    return res.status(400).json({ error: 'Please send valid panel wattages! Example: /solar?city=Lahore&wattages=300,300,250' });
  }

  const panels = wattages.length;
  const totalWattage = wattages.reduce((sum, w) => sum + w, 0); // each panel's own wattage added up
  const systemSizeKw = totalWattage / 1000;

  try {
    const place = await getCoordinates(city);
    if (!place) {
      return res.status(404).json({ error: 'City not found — please check the spelling' });
    }

    // shortwave_radiation -> hourly sunlight intensity (W/m^2), this drives the real Peak Sun Hours calculation
    // daylight_duration   -> informational only (how long the sun was up, NOT used in the calculation)
    // weather_code (daily) -> used to classify today as clear/partly cloudy/cloudy/rainy for the confidence range
    // timeout -> if Open-Meteo doesn't respond within 10 seconds, fail fast instead of hanging forever
    const response = await axios.get('https://api.open-meteo.com/v1/forecast', {
      timeout: 10000,
      params: {
        latitude: place.latitude,
        longitude: place.longitude,
        current: 'temperature_2m,weather_code', // live condition - drives the dynamic heading + hot-weather tip
        hourly: 'temperature_2m,relative_humidity_2m,shortwave_radiation,cloud_cover',
        daily: 'daylight_duration,weather_code,sunrise,sunset',
        timezone: 'auto',
        forecast_days: 1,
        forecast_hours: 24
      }
    });

    const d = response.data;

    // ===== DAYLIGHT HOURS (informational only - how long the sun was up) =====
    const daylightHours = d.daily.daylight_duration[0] / 3600;

    // ===== TODAY'S SKY CONDITION (baseline for the confidence range) =====
    const skyCondition = classifySkyCondition(d.daily.weather_code[0]);
    const baseRangeInfo = RANGE_BY_CONDITION[skyCondition];

    // ===== REFINE THE RANGE USING ACTUAL CLOUD COVER VARIABILITY (not just the weather code) =====
    // Two "cloudy" days can behave very differently: steady 100% overcast is actually fairly
    // predictable, while cloud cover swinging between 20% and 90% through the day is not.
    // We measure that swing (std. deviation of today's hourly cloud cover %) and widen/narrow
    // the spread slightly around the weather-code baseline to reflect real-world variability.
    const todayCloudCoverValues = (d.hourly.cloud_cover || []).slice(0, 24);
    let cloudVariability = 0;
    if (todayCloudCoverValues.length > 1) {
      const meanCloud = todayCloudCoverValues.reduce((s, v) => s + v, 0) / todayCloudCoverValues.length;
      const variance = todayCloudCoverValues.reduce((s, v) => s + Math.pow(v - meanCloud, 2), 0) / todayCloudCoverValues.length;
      cloudVariability = Math.sqrt(variance); // std deviation, in cloud-cover percentage points
    }
    // Every 20 percentage points of cloud-cover swing nudges the spread by up to +/-3 points (0.03),
    // capped so a single noisy hour can't blow the range out unrealistically.
    const variabilityAdjustment = Math.min(0.06, (cloudVariability / 20) * 0.03);
    const adjustedSpread = Math.min(0.35, baseRangeInfo.spread + variabilityAdjustment);
    const rangeInfo = { ...baseRangeInfo, spread: adjustedSpread };

    // ===== DYNAMIC SOLAR HEADING (matches the LIVE current condition, not a hardcoded string) =====
    const liveWeatherCode = d.current ? d.current.weather_code : d.daily.weather_code[0];
    const solarHeading = weatherCodeToHeading(liveWeatherCode) + ' — ESTIMATED OUTPUT';
    const currentTemp = d.current ? d.current.temperature_2m : null;

    // ===== COMBINE EACH HOUR'S RADIATION/TEMP/HUMIDITY =====
    function formatHour(isoString) {
      const hourPart = isoString.split('T')[1];
      let [hours, mins] = hourPart.split(':').map(Number);
      const period = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      if (hours === 0) hours = 12;
      return `${hours}:${mins.toString().padStart(2, '0')} ${period}`;
    }

    const hours = d.hourly.time.map((time, i) => ({
      time,
      date: time.split('T')[0], // calendar date this hour belongs to, e.g. "2026-06-28"
      label: formatHour(time),
      radiation: d.hourly.shortwave_radiation[i] || 0,
      temp: d.hourly.temperature_2m[i],
      humidity: d.hourly.relative_humidity_2m[i]
    }));

    // ===== PEAK SUN HOURS (real formula) =====
    // 1 Peak Sun Hour = 1000 Wh/m^2 of sunlight (equivalent to standard test conditions).
    // Sum every hour's radiation (W/m^2 ~ Wh/m^2 per hour) and divide by 1000.
    const totalRadiationWhPerM2 = hours.reduce((sum, h) => sum + h.radiation, 0);
    const peakSunHours = totalRadiationWhPerM2 / 1000;

    // ===== SOLAR OUTPUT (System Size x Peak Sun Hours x Efficiency) =====
    const solarOutputKwh = systemSizeKw * peakSunHours * SOLAR_EFFICIENCY;
    const solarOutputWh = solarOutputKwh * 1000;

    // ===== OUTPUT RANGE (more realistic than one exact number) =====
    // Width of the range scales with how predictable today's sky is.
    // FIX: when confidence is High, the range is too narrow to be useful (e.g. 7.61-8.41) -
    // a single number reads cleaner. Only show a real range when there's meaningful uncertainty.
    const rangeLowKwh = solarOutputKwh * (1 - rangeInfo.spread);
    const rangeHighKwh = solarOutputKwh * (1 + rangeInfo.spread);
    const showRange = rangeInfo.confidence !== 'High';

    // ===== ELECTRICITY SAVINGS (matches whatever is shown above - single value or range) =====
    const savingsLow = rangeLowKwh * electricityRate;
    const savingsHigh = rangeHighKwh * electricityRate;
    const savingsSingle = solarOutputKwh * electricityRate;

    // ===== PEAK SUNLIGHT WINDOW (solar-noon based, not radiation-threshold based) =====
    // FIX: the previous radiation-threshold approach could occasionally pick a backwards or
    // late-evening-looking window. Real solar installers define the "peak sun window" as the hours
    // straddling solar noon (the midpoint between sunrise and sunset, when the sun is highest) - this
    // is the standard, well-behaved way to calculate it and never depends on hardcoded clock times.
    // For a city like Multan (sunrise ~6 AM, sunset ~7 PM in summer) this centers around ~11 AM-3 PM,
    // matching real-world expectations, and shifts automatically with season/latitude/longitude.
    const sunriseStr = d.daily.sunrise[0]; // ISO local time, e.g. "2026-06-28T05:12"
    const sunsetStr = d.daily.sunset[0];

    function parseLocalTime(isoString) {
      const timePart = isoString.split('T')[1];
      const [h, m] = timePart.split(':').map(Number);
      return h * 60 + m; // minutes since local midnight
    }
    function minutesToLabel(totalMinutes) {
      let h = Math.floor(totalMinutes / 60);
      const m = Math.round(totalMinutes % 60);
      const period = h >= 12 ? 'PM' : 'AM';
      h = h % 12;
      if (h === 0) h = 12;
      return `${h}:${m.toString().padStart(2, '0')} ${period}`;
    }

    const sunriseMin = parseLocalTime(sunriseStr);
    const sunsetMin = parseLocalTime(sunsetStr);
    const solarNoonMin = (sunriseMin + sunsetMin) / 2;

    const PEAK_WINDOW_HALF_SPAN_MIN = 120; // +/- 2 hours around solar noon = a 4-hour peak window
    const peakStartMin = Math.max(sunriseMin, solarNoonMin - PEAK_WINDOW_HALF_SPAN_MIN);
    const peakEndMin = Math.min(sunsetMin, solarNoonMin + PEAK_WINDOW_HALF_SPAN_MIN);

    const peakWindow = `${minutesToLabel(peakStartMin)} – ${minutesToLabel(peakEndMin)}`;
    const peakWindowHours = Math.max(0, Math.round(((peakEndMin - peakStartMin) / 60) * 10) / 10);
    const solarNoonLabel = minutesToLabel(solarNoonMin);

    // ===== TODAY'S HOURS THAT FALL INSIDE THE PEAK WINDOW (used for laundry-drying-speed only) =====
    const todayDate = hours.length ? hours[0].date : null;
    const todayHours = hours.filter(h => h.date === todayDate);
    const peakHoursData = todayHours.filter(h => {
      const mins = parseLocalTime(h.time);
      return mins >= peakStartMin && mins <= peakEndMin;
    });

    // ===== LAUNDRY DRYING SPEED (estimated from peak-window temp/humidity) =====
    let dryingSpeed = 'Slow (4+ hours)';
    if (peakHoursData.length) {
      const avgTemp = peakHoursData.reduce((s, h) => s + h.temp, 0) / peakHoursData.length;
      const avgHumidity = peakHoursData.reduce((s, h) => s + h.humidity, 0) / peakHoursData.length;
      if (avgTemp >= 35 && avgHumidity <= 40) dryingSpeed = 'Fast (1–2 hours)';
      else if (avgTemp >= 28 && avgHumidity <= 60) dryingSpeed = 'Moderate (2–4 hours)';
    }

    // ===== AC SUPPORT ESTIMATE =====
    function acHoursFromKwh(kwh) {
      const energyEquivalentHours = kwh / AC_TON_KW;
      const realisticHours = Math.min(energyEquivalentHours, daylightHours);
      return {
        energyEquivalent: Math.round(energyEquivalentHours * 2) / 2,
        realistic: Math.round(realisticHours * 2) / 2
      };
    }
    const acLow = acHoursFromKwh(rangeLowKwh);
    const acHigh = acHoursFromKwh(rangeHighKwh);
    const acSingleVal = acHoursFromKwh(solarOutputKwh);

    const acHoursLow = acLow.realistic;
    const acHoursHigh = acHigh.realistic;
    const acHoursSingle = acSingleVal.realistic;
    const acEnergyEquivalentLow = acLow.energyEquivalent;
    const acEnergyEquivalentHigh = acHigh.energyEquivalent;
    const acEnergyEquivalentSingle = acSingleVal.energyEquivalent;

    // ===== SMART RECOMMENDATIONS (weather-category based, multiple actionable tips) =====
    const SMART_TIPS_BY_CONDITION = {
      clear: [
        'Charge batteries now — solar output is at its best.',
        'Run the washing machine and other heavy appliances now.',
        'Maximize solar usage while the sun is strong.'
      ],
      partly_cloudy: [
        'Good solar output today — running heavy appliances now will still lower your bill.',
        'Charge devices and batteries while the sun is out.'
      ],
      cloudy: [
        'Expect reduced solar production today.',
        'Delay heavy electrical loads where possible.'
      ],
      rainy: [
        'Prepare for lower solar output today.',
        'Avoid outdoor drying — expect rain.'
      ]
    };
    const tips = [];
    tips.push(...(SMART_TIPS_BY_CONDITION[skyCondition] || SMART_TIPS_BY_CONDITION.cloudy));

    // Thunderstorm gets its own extra warning, layered on top of the base "rainy" tips above
    const THUNDERSTORM_CODES = [95, 96, 99];
    if (THUNDERSTORM_CODES.includes(liveWeatherCode)) {
      tips.push('Protect sensitive electronics — thunderstorm activity expected.');
      tips.push('Expect highly variable solar generation during the storm.');
    }

    // Heatwave tip — only shown when it's actually very hot right now, based on the live current temp
    const HEATWAVE_THRESHOLD_C = 40;
    const HOT_WEATHER_THRESHOLD_C = 35;
    if (typeof currentTemp === 'number' && currentTemp >= HEATWAVE_THRESHOLD_C) {
      tips.push('Heatwave conditions — stay hydrated.');
      tips.push('Reduce afternoon cooling load where possible.');
    } else if (typeof currentTemp === 'number' && currentTemp >= HOT_WEATHER_THRESHOLD_C) {
      tips.push('Hot day — close curtains/blinds during afternoon hours to reduce AC load and cooling costs.');
    }

    tips.push('Avoid opening the fridge unnecessarily during peak solar hours — it keeps proper temperature overnight too.');
    tips.push('Charge phones, laptops, and batteries during peak solar hours while the power is free.');

    res.json({
      city: place.name,
      country: place.country,
      solar_heading: solarHeading,       // dynamic heading e.g. "☀️ CLEAR SKY — ESTIMATED OUTPUT"
      solar_noon: solarNoonLabel,        // e.g. "1:05 PM" - the midpoint the peak window is centered on
      current_temp_c: currentTemp,
      panels,
      total_wattage: totalWattage,
      system_size_kw: Math.round(systemSizeKw * 100) / 100,
      daylight_hours: Math.round(daylightHours * 10) / 10,       // informational only
      peak_sun_hours: Math.round(peakSunHours * 100) / 100,      // used in the calculation
      efficiency_percent: Math.round(SOLAR_EFFICIENCY * 100),
      solar_output_wh: Math.round(solarOutputWh),
      solar_output_kwh: Math.round(solarOutputKwh * 100) / 100,
      sky_condition: skyCondition,
      sky_condition_label: rangeInfo.label,
      confidence: rangeInfo.confidence,
      confidence_explanation: CONFIDENCE_EXPLANATIONS[rangeInfo.confidence] || '',
      cloud_variability_points: Math.round(cloudVariability),
      show_range: showRange,
      output_range_kwh: {
        low: Math.round(rangeLowKwh * 100) / 100,
        high: Math.round(rangeHighKwh * 100) / 100
      },
      output_single_kwh: Math.round(solarOutputKwh * 100) / 100,
      electricity_rate: electricityRate,
      rate_was_defaulted: !(rateParam > 0),
      savings_range_rs: {
        low: Math.round(savingsLow),
        high: Math.round(savingsHigh)
      },
      savings_single_rs: Math.round(savingsSingle),
      peak_solar_hours: peakWindow,
      peak_solar_hours_count: peakWindowHours,
      best_washing_time: peakWindow,
      ac_ton_assumed: AC_TON_KW,
      ac_hours_range: { low: acHoursLow, high: acHoursHigh },
      ac_hours_single: acHoursSingle,
      ac_energy_equivalent_range: { low: acEnergyEquivalentLow, high: acEnergyEquivalentHigh },
      ac_energy_equivalent_single: acEnergyEquivalentSingle,
      best_ac_time: `${peakWindow} (while solar power is free)`,
      laundry_drying_speed: dryingSpeed,
      tips
    });

  } catch (error) {
    handleWeatherError(error, res);
  }
});

// ============ SEARCH HISTORY ============
app.get('/history', (req, res) => {
  const history = readJSONFile(HISTORY_FILE);
  res.json({ recent_searches: history });
});

// ============ FAVORITES ============
app.get('/favorites', (req, res) => {
  const favorites = readJSONFile(FAVORITES_FILE);
  res.json({ favorite_cities: favorites });
});

app.post('/favorites', (req, res) => {
  const city = req.body.city ? req.body.city.trim() : '';

  if (!city) {
    return res.status(400).json({ error: 'Please send a city in the request body! Example: { "city": "Karachi" }' });
  }

  const favorites = readJSONFile(FAVORITES_FILE);

  if (favorites.includes(city)) {
    return res.status(400).json({ error: 'This city is already in your favorites' });
  }

  favorites.push(city);
  writeJSONFile(FAVORITES_FILE, favorites);

  res.json({ message: `${city} added to favorites!`, favorite_cities: favorites });
});

// ============ HELPER: ERROR HANDLING ============
function handleWeatherError(error, res) {
  console.error('Weather/solar request failed:', error.message);

  if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
    res.status(504).json({ error: 'Weather service took too long to respond — please try again' });
  } else if (error.response) {
    const status = error.response.status;
    res.status(status).json({ error: 'Weather service returned an error' });
  } else if (error.request) {
    res.status(502).json({ error: 'Could not reach the weather service — check your internet connection' });
  } else {
    res.status(500).json({ error: 'Server error — please try again later' });
  }
}

const CODE_VERSION = 'v10-polish-confidence-aqi-uv-compare-tooltips';

app.get('/version', (req, res) => {
  res.json({ version: CODE_VERSION });
});

app.listen(PORT, () => {
  console.log('Server is running on port ' + PORT + '!');
  console.log('Code version: ' + CODE_VERSION);
});
module.exports = app;
