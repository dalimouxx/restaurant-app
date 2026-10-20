import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { settingsApi } from '../lib/api'

/**
 * Carte de suivi de livraison.
 *
 * Leaflet est piloté directement plutôt que via react-leaflet : on
 * recentre à chaque position reçue, et recréer la carte à chaque fois
 * ferait clignoter le fond.
 *
 * Le fond de carte vient des réglages, pas d'une constante ici. Le
 * serveur public d'OpenStreetMap est tenu par des bénévoles et sa
 * politique d'usage le réserve à un trafic modeste : passé ce seuil il
 * répond des tuiles « Access blocked » — des images parfaitement
 * valides, donc aucune erreur réseau à intercepter, juste une carte
 * illisible. Une installation en service renseigne l'adresse de son
 * propre fournisseur dans Réglages.
 *
 * Et quoi qu'il arrive au fond, les deux repères et la ligne restent
 * tracés : même sur un carré gris, le livreur voit la direction et la
 * distance, et le bouton d'itinéraire de son écran reste utilisable.
 */

/** Une seule requête de réglages pour toute la session, quel que soit l'écran. */
let fond: Promise<{ url: string; attribution: string }> | null = null

const FOND_PAR_DEFAUT = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap',
}

function fondDeCarte() {
  if (!fond) {
    fond = settingsApi
      .get()
      .then((s) => ({
        url: s.mapTileUrl?.trim() || FOND_PAR_DEFAUT.url,
        attribution: s.mapAttribution?.trim() || FOND_PAR_DEFAUT.attribution,
      }))
      .catch(() => FOND_PAR_DEFAUT)
  }
  return fond
}

export function DeliveryMap({
  driver,
  destination,
  className = '',
}: {
  driver?: { lat: number; lng: number } | null
  destination?: { lat: number; lng: number } | null
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const driverRef = useRef<L.Marker | null>(null)
  const destRef = useRef<L.Marker | null>(null)
  const lineRef = useRef<L.Polyline | null>(null)
  const [panne, setPanne] = useState(false)

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return

    const center = driver ?? destination ?? { lat: 33.8869, lng: 9.5375 } // Tunisie
    const map = L.map(hostRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([center.lat, center.lng], 14)

    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapRef.current = map

    let vivant = true
    fondDeCarte().then(({ url, attribution }) => {
      if (!vivant || !mapRef.current) return
      const couche = L.tileLayer(url, { attribution, maxZoom: 19 })
      // Un fournisseur qui refuse la clé répond 403 : on le dit, plutôt
      // que de laisser un carré vide sans explication.
      couche.on('tileerror', () => setPanne(true))
      couche.on('tileload', () => setPanne(false))
      couche.addTo(mapRef.current)
    })

    return () => {
      vivant = false
      map.remove()
      mapRef.current = null
      driverRef.current = null
      destRef.current = null
      lineRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (destination) {
      if (!destRef.current) {
        destRef.current = L.marker([destination.lat, destination.lng], {
          icon: pinIcon('#101418', 'home'),
        }).addTo(map)
      } else {
        destRef.current.setLatLng([destination.lat, destination.lng])
      }
    }

    if (driver) {
      if (!driverRef.current) {
        driverRef.current = L.marker([driver.lat, driver.lng], {
          icon: pinIcon('#0B6B5B', 'bike'),
        }).addTo(map)
      } else {
        driverRef.current.setLatLng([driver.lat, driver.lng])
      }
    }

    if (driver && destination) {
      const path: L.LatLngExpression[] = [
        [driver.lat, driver.lng],
        [destination.lat, destination.lng],
      ]
      if (!lineRef.current) {
        lineRef.current = L.polyline(path, {
          color: '#0B6B5B',
          weight: 3,
          opacity: 0.55,
          dashArray: '6 8',
        }).addTo(map)
      } else {
        lineRef.current.setLatLngs(path)
      }
      map.fitBounds(L.latLngBounds(path).pad(0.35), { animate: true })
    } else if (driver) {
      map.panTo([driver.lat, driver.lng], { animate: true })
    }
  }, [driver, destination])

  return (
    <div className={`relative ${className}`}>
      <div ref={hostRef} className="h-full w-full" />
      {panne && (
        <div className="pointer-events-none absolute inset-x-2 top-2 z-[500] rounded-[9px] bg-ink-900/90 px-3 py-2 text-[12px] font-semibold leading-snug text-white">
          Fond de carte indisponible. Les repères restent justes — utilisez
          l'itinéraire.
        </div>
      )}
    </div>
  )
}

function pinIcon(color: string, kind: 'bike' | 'home') {
  const glyph =
    kind === 'bike'
      ? '<circle cx="7" cy="16" r="3.2"/><circle cx="17" cy="16" r="3.2"/><path d="M7 16l3.5-7h4l2.5 7M13 9h3"/>'
      : '<path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>'

  return L.divIcon({
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `
      <span style="
        display:grid;place-items:center;width:34px;height:34px;
        border-radius:50%;background:${color};
        box-shadow:0 2px 10px rgba(16,20,24,.35);border:2.5px solid #fff;">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
             stroke="#fff" stroke-width="2" stroke-linecap="round"
             stroke-linejoin="round">${glyph}</svg>
      </span>`,
  })
}
