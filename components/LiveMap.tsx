
import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { LocationData } from '../types';
import { Eye, Map as MapIcon, ShieldCheck, Lock, Radio } from 'lucide-react';

const markerIconUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png';
const markerIcon2xUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png';
const markerShadowUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
});

// Custom colored markers
const createColoredIcon = (color: string) => L.divIcon({
  className: 'custom-marker',
  html: `<div style="
    background-color: ${color};
    width: 24px;
    height: 24px;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    border: 2px solid white;
    box-shadow: 0 2px 5px rgba(0,0,0,0.4);
  "></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 24],
  popupAnchor: [0, -24],
});

// Vehicle icons — large with solid colored circular background
const createVehicleIcon = (emoji: string, color: string) => L.divIcon({
  className: '',  // Empty to prevent Leaflet's default white bg/border
  html: `<div style="
    width: 40px;
    height: 40px;
    background: ${color};
    border: 3px solid white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    box-shadow: 0 0 12px ${color}, 0 2px 8px rgba(0,0,0,0.6);
    animation: pulse 1.5s ease-in-out infinite;
  ">${emoji}</div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -20],
});

const primaryIcon = createColoredIcon('#ef4444');
const secondaryIcon = createColoredIcon('#3b82f6');
const hospitalIcon = createColoredIcon('#22c55e');
const schoolIcon = createColoredIcon('#f59e0b');

function MapUpdater({ center, hasLocation }: { center: [number, number], hasLocation: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (hasLocation) {
      map.flyTo(center, 17, { duration: 1.5, easeLinearity: 0.25 });
    }
  }, [center, hasLocation, map]);
  return null;
}

function MapAutoResizer() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 250);
    const handleResize = () => map.invalidateSize();
    window.addEventListener('resize', handleResize);
    return () => { clearTimeout(timer); window.removeEventListener('resize', handleResize); };
  }, [map]);
  return null;
}

// Secondary location type
export interface SecondaryLocation {
  address: string;
  lat: number;
  lng: number;
  type: 'hospital' | 'school' | 'secondary' | 'route';
}

// Dispatch route type
export interface DispatchRoute {
  id: string;
  unitType: string;           // 'fire', 'police', 'ambulance', 'hazmat'
  stationName: string;
  stationCoords: [number, number];
  destinationCoords: [number, number];
  waypoints: [number, number][];  // Full route path
  color: string;
  emoji: string;
  dispatchedAt: number;       // timestamp
}

// Animated vehicle that moves along a route
const AnimatedVehicle: React.FC<{ route: DispatchRoute; onArrival?: (route: DispatchRoute) => void }> = ({ route, onArrival }) => {
  const [progress, setProgress] = useState(0);
  const arrivedRef = useRef(false);

  useEffect(() => {
    const startTime = route.dispatchedAt;
    const duration = 60000; // 60 seconds to reach destination

    const tick = () => {
      const elapsed = Date.now() - startTime;
      const p = Math.min(elapsed / duration, 1);
      setProgress(p);
      if (p >= 1 && !arrivedRef.current) {
        arrivedRef.current = true;
        onArrival?.(route);
      }
    };

    // Use setInterval (not rAF) so it keeps running even when tab is blurred
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [route.dispatchedAt, route, onArrival]);

  // Interpolate position along waypoints
  const getPosition = (p: number): [number, number] => {
    const pts = route.waypoints;
    if (pts.length < 2) return pts[0] || route.stationCoords;
    const totalSegments = pts.length - 1;
    const segIdx = Math.min(Math.floor(p * totalSegments), totalSegments - 1);
    const segProgress = (p * totalSegments) - segIdx;
    const lat = pts[segIdx][0] + (pts[segIdx + 1][0] - pts[segIdx][0]) * segProgress;
    const lng = pts[segIdx][1] + (pts[segIdx + 1][1] - pts[segIdx][1]) * segProgress;
    return [lat, lng];
  };

  const pos = getPosition(progress);
  const vehicleIcon = createVehicleIcon(route.emoji, route.color);

  // Show the trail (completed portion of route)
  const trailEnd = Math.floor(progress * (route.waypoints.length - 1)) + 1;
  const trailPoints = route.waypoints.slice(0, Math.min(trailEnd + 1, route.waypoints.length));

  return (
    <>
      {/* Full route path (faded) */}
      <Polyline
        positions={route.waypoints}
        pathOptions={{
          color: route.color,
          weight: 3,
          opacity: 0.2,
          dashArray: '8, 8',
        }}
      />
      {/* Completed trail (solid) */}
      {trailPoints.length > 1 && (
        <Polyline
          positions={trailPoints}
          pathOptions={{
            color: route.color,
            weight: 4,
            opacity: 0.8,
          }}
        />
      )}
      {/* Vehicle marker */}
      <Marker position={pos} icon={vehicleIcon}>
        <Popup>
          <div className="text-gray-900 font-bold p-1">
            <p className="text-[10px] font-bold" style={{ color: route.color }}>
              {route.emoji} {route.unitType.toUpperCase()} UNIT
            </p>
            <p className="text-[9px] font-normal text-gray-600">From: {route.stationName}</p>
            <p className="text-[9px] font-normal text-gray-500">ETA: {Math.max(0, Math.floor((1 - progress) * 60))}s</p>
          </div>
        </Popup>
      </Marker>
      {/* Station marker */}
      <Marker position={route.stationCoords} icon={createColoredIcon(route.color)}>
        <Popup>
          <div className="text-gray-900 font-bold p-1">
            <p className="text-[10px]">{route.emoji} {route.stationName}</p>
          </div>
        </Popup>
      </Marker>
    </>
  );
}

interface LiveMapProps {
  location: LocationData | null;
  reconImage: string | null;
  isGeneratingImage: boolean;
  perimeterRadius?: number;
  secondaryLocations?: SecondaryLocation[];
  dispatchRoutes?: DispatchRoute[];
  onVehicleArrived?: (route: DispatchRoute) => void;
}

const LiveMap: React.FC<LiveMapProps> = ({
  location,
  reconImage,
  isGeneratingImage,
  perimeterRadius = 0,
  secondaryLocations = [],
  dispatchRoutes = [],
  onVehicleArrived
}) => {
  const defaultCenter: [number, number] = [40.7128, -74.0060];
  const center: [number, number] = location ? [location.lat, location.lng] : defaultCenter;

  const isVisualLocked = location && (location.confidence === 'Locked' || location.confidence === 'High');

  const getIconForType = (type: string) => {
    switch (type) {
      case 'hospital': return hospitalIcon;
      case 'school': return schoolIcon;
      default: return secondaryIcon;
    }
  };

  return (
    <div className="flex-1 w-full flex flex-row gap-3 overflow-hidden h-full">
      {/* LEFT: Visual Recon */}
      <div className="w-1/2 bg-gray-950 rounded-xl border border-gray-800 overflow-hidden flex flex-col shadow-2xl transition-all duration-1000 group">
        <div className="p-2.5 border-b border-gray-800 bg-gray-900/30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Eye size={14} className={reconImage ? "text-blue-500" : "text-gray-700"} />
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Visual Recon</span>
          </div>
          {reconImage && (
            <div className="bg-blue-900/30 px-2 py-0.5 rounded text-[8px] font-bold text-blue-400 border border-blue-500/20 animate-pulse">
              LIVE FEED
            </div>
          )}
        </div>
        <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden min-h-0">
          {reconImage ? (
            <>
              <img
                src={reconImage}
                alt="Tactical Recon"
                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity duration-700"
              />
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-3 left-3 border-l-2 border-t-2 border-green-500/50 w-6 h-6" />
                <div className="absolute top-3 right-3 border-r-2 border-t-2 border-green-500/50 w-6 h-6" />
                <div className="absolute bottom-3 left-3 border-l-2 border-b-2 border-green-500/50 w-6 h-6" />
                <div className="absolute bottom-3 right-3 border-r-2 border-b-2 border-green-500/50 w-6 h-6" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-green-500/30">
                  <Radio size={36} className="animate-ping" />
                </div>
                <div className="absolute bottom-2 left-2 text-[7px] font-mono text-green-500/80">
                  CAM-04 // NIGHT_VISION // REC
                </div>
              </div>
            </>
          ) : isGeneratingImage ? (
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
              <p className="text-[8px] font-mono text-blue-400 uppercase tracking-widest animate-pulse">Acquiring Uplink...</p>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-800 p-6 text-center bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-gray-900 to-black">
              <Lock size={28} className="mb-3 opacity-20" />
              <p className="text-[8px] font-mono uppercase tracking-[0.15em] opacity-40">Feed encrypted: Awaiting visual confirmation</p>
              <div className="mt-3 flex gap-1">
                {[1, 2, 3].map(i => <div key={i} className="w-1 h-1 bg-gray-800 rounded-full animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Tactical Map */}
      <div className="w-1/2 rounded-xl overflow-hidden shadow-2xl border border-gray-800 relative z-0 bg-gray-900">
        <MapContainer
          center={center}
          zoom={location ? 17 : 4}
          scrollWheelZoom={true}
          className="h-full w-full"
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; CARTO'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />

          {/* Primary location marker */}
          {location && (
            <Marker position={[location.lat, location.lng]} icon={primaryIcon}>
              <Popup>
                <div className="text-gray-900 font-bold p-1">
                  <p className="border-b border-gray-200 pb-1 mb-1 text-red-600">🚨 PRIMARY INCIDENT</p>
                  <p className="text-[10px] font-normal text-gray-700">{location.address}</p>
                </div>
              </Popup>
            </Marker>
          )}

          {/* Perimeter circle for lockdown */}
          {location && perimeterRadius > 0 && (
            <Circle
              center={[location.lat, location.lng]}
              radius={perimeterRadius}
              pathOptions={{
                color: '#ef4444',
                fillColor: '#ef4444',
                fillOpacity: 0.15,
                weight: 2,
                dashArray: '10, 5',
              }}
            />
          )}

          {/* Secondary location markers */}
          {secondaryLocations.map((loc, index) => (
            <Marker
              key={index}
              position={[loc.lat, loc.lng]}
              icon={getIconForType(loc.type)}
            >
              <Popup>
                <div className="text-gray-900 font-bold p-1">
                  <p className="border-b border-gray-200 pb-1 mb-1 text-blue-600">
                    {loc.type === 'hospital' ? '🏥 HOSPITAL' :
                      loc.type === 'school' ? '🏫 SCHOOL' :
                        '📍 SECONDARY LOCATION'}
                  </p>
                  <p className="text-[10px] font-normal text-gray-700">{loc.address}</p>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Dispatch vehicle routes */}
          {dispatchRoutes.map((route) => (
            <AnimatedVehicle key={route.id} route={route} onArrival={onVehicleArrived} />
          ))}

          <MapUpdater center={center} hasLocation={!!location} />
          <MapAutoResizer />
        </MapContainer>

        {/* Map Overlay Stats */}
        <div className="absolute top-3 left-3 z-[400] flex flex-col gap-1.5 pointer-events-none">
          <div className="bg-gray-950/90 backdrop-blur-md px-2.5 py-1 rounded border border-gray-800 flex items-center gap-1.5">
            <div className={isVisualLocked ? "text-green-500" : "text-yellow-500 animate-pulse"}>
              <ShieldCheck size={12} />
            </div>
            <span className="text-[8px] font-black uppercase tracking-widest text-gray-300">
              {isVisualLocked ? "Lock Stable" : "Triangulating..."}
            </span>
          </div>

          {perimeterRadius > 0 && (
            <div className="bg-red-950/90 backdrop-blur-md px-2.5 py-1 rounded border border-red-500/50 flex items-center gap-1.5">
              <Lock size={12} className="text-red-500" />
              <span className="text-[8px] font-black uppercase tracking-widest text-red-300">
                PERIMETER: {perimeterRadius}m
              </span>
            </div>
          )}

          {secondaryLocations.length > 0 && (
            <div className="bg-blue-950/90 backdrop-blur-md px-2.5 py-1 rounded border border-blue-500/50 flex items-center gap-1.5">
              <MapIcon size={12} className="text-blue-500" />
              <span className="text-[8px] font-black uppercase tracking-widest text-blue-300">
                {secondaryLocations.length} MARKED
              </span>
            </div>
          )}

          {/* Dispatch routes indicator */}
          {dispatchRoutes.length > 0 && (
            <div className="bg-green-950/90 backdrop-blur-md px-2.5 py-1 rounded border border-green-500/50 flex items-center gap-1.5">
              <span className="text-[10px]">🚨</span>
              <span className="text-[8px] font-black uppercase tracking-widest text-green-300">
                {dispatchRoutes.length} UNITS EN ROUTE
              </span>
            </div>
          )}
        </div>

        <div className="absolute bottom-3 right-3 z-[400] bg-gray-900/95 backdrop-blur-md p-2.5 rounded-lg border border-red-500/30 shadow-2xl max-w-[180px] pointer-events-none">
          <div className="flex items-center gap-1.5 mb-1">
            <MapIcon size={12} className="text-red-500" />
            <h3 className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Tactical Map</h3>
          </div>
          {location ? (
            <div className="pointer-events-auto">
              <div className="text-[10px] font-bold text-white leading-tight mb-0.5 line-clamp-2">{location.address}</div>
              <div className="text-[8px] text-green-400 font-mono flex items-center gap-1">
                <Lock size={7} /> {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
              </div>
            </div>
          ) : (
            <div className="text-[8px] text-gray-600 italic">No target data...</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveMap;
