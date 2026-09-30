// Browser GPS -> country code, for the location filter.
//
// The 5fish data lists languages by country, so coordinates are turned into
// a country with data/countries.geojson (Natural Earth 1:110m borders, built by
// tools/build_data.py). Works offline; nothing is sent to a third party.
// Low-resolution borders can misplace points within a few km of a border.

/** Ask the browser for the device position. Shows the browser's permission prompt. */
export function getPosition({ timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This browser has no location support'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? 'Location permission denied' : err.message)),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 },
    )
  })
}

let bordersPromise = null
function loadBorders(url = 'data/countries.geojson') {
  bordersPromise ??= fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Could not load ${url}: ${r.status}`)
    return r.json()
  })
  return bordersPromise
}

/** GPS position -> { code, name, lat, lon }, or code null if outside every country (at sea). */
export async function detectCountry() {
  const [{ lat, lon }, borders] = await Promise.all([getPosition(), loadBorders()])
  const feature = countryAt(lat, lon, borders)
  return { code: feature?.properties.code ?? null, name: feature?.properties.name ?? null, lat, lon }
}

/** The GeoJSON feature containing the point, or null. GeoJSON coordinates are [lon, lat]. */
export function countryAt(lat, lon, featureCollection) {
  for (const feature of featureCollection.features) {
    const { type, coordinates } = feature.geometry
    const polygons = type === 'Polygon' ? [coordinates] : type === 'MultiPolygon' ? coordinates : []
    if (polygons.some((rings) => inPolygon(lon, lat, rings))) return feature
  }
  return null
}

// First ring is the outline; any others are holes (e.g. Lesotho inside South Africa).
function inPolygon(x, y, rings) {
  return inRing(x, y, rings[0]) && !rings.slice(1).some((hole) => inRing(x, y, hole))
}

// Ray casting: count how many edges a ray going right from the point crosses.
function inRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
