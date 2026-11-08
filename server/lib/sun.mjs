// Sunrise, sunset, and weather for the city outside the window (Open-Meteo, no key), or times typed in by hand.

// ───────────────────────── Sunrise, sunset, weather ─────────────────────────
// Cities used for the weather and sunrise/sunset outside the window. Seoul is the default; the app menu picks one.
export const CITIES = { seoul: [37.5665, 126.978], tokyo: [35.6762, 139.6503], newyork: [40.7128, -74.006], london: [51.5074, -0.1278], sydney: [-33.8688, 151.2093] };
// With timezone=auto, Open-Meteo returns sunrise and sunset in the city's local time, plus the UTC offset in seconds.
export const forecastUrl = (lat, lon) => `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=sunrise,sunset&current=weather_code&timezone=auto&forecast_days=1`;
export function parseForecast(j) {
  const h = (iso) => { const [hh, mm] = iso.split('T')[1].split(':'); return +hh + +mm / 60; };
  return { sunrise: h(j.daily.sunrise[0]), sunset: h(j.daily.sunset[0]), weather: j.current?.weather_code ?? 0, utcOffset: Number.isFinite(j.utc_offset_seconds) ? j.utc_offset_seconds : null };
}
export const sun = { sunrise: 6, sunset: 19, manual: false, ok: false, fetchedAt: 0, weather: 0, utcOffset: null, city: CITIES[process.env.CLAUDE_OFFICE_CITY] ? process.env.CLAUDE_OFFICE_CITY : 'seoul', theme: process.env.CLAUDE_OFFICE_THEME || 'office' };
const envSun = (process.env.CLAUDE_OFFICE_SUN || '').match(/^(\d{1,2}):(\d{2}),(\d{1,2}):(\d{2})$/);
if (envSun) { sun.manual = true; sun.sunrise = +envSun[1] + +envSun[2] / 60; sun.sunset = +envSun[3] + +envSun[4] / 60; }
let firstFetch;
export async function fetchSun() {
  if (sun.manual || sun.theme === 'mine') return;
  try {
    const [lat, lon] = CITIES[sun.city];
    const j = await (await fetch(forecastUrl(lat, lon), { signal: AbortSignal.timeout(5000) })).json();
    const f = parseForecast(j);
    sun.sunrise = f.sunrise; sun.sunset = f.sunset; sun.weather = f.weather; sun.utcOffset = f.utcOffset; sun.ok = true; sun.fetchedAt = Date.now();
  } catch { sun.ok = false; }
}
firstFetch = fetchSun();
setInterval(fetchSun, 30 * 60_000).unref();
export const sunView = () => ({ sunrise: sun.sunrise, sunset: sun.sunset, manual: sun.manual, ok: sun.ok, fetchedAt: sun.fetchedAt, weather: sun.manual ? 0 : sun.weather, city: sun.city, utcOffset: sun.manual ? null : sun.utcOffset });
// Resolves once the first lookup finished, so the first request after startup waits for real values.
export const sunReady = () => firstFetch;
