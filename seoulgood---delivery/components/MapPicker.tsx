
import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Search, Store, Crosshair } from 'lucide-react';
import { LocationState } from '../types';

// --- FIX: Use CDN URLs instead of importing images directly ---
// Browsers cannot import .png files directly without a bundler like Webpack/Vite.
const iconUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png';
const iconRetinaUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png';
const shadowUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png';

// Configure default icon globally
const DefaultIcon = L.icon({
    iconUrl: iconUrl,
    iconRetinaUrl: iconRetinaUrl,
    shadowUrl: shadowUrl,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface MapPickerProps {
  onLocationSelect: (loc: LocationState) => void;
  initialLocation?: LocationState | null;
}

// Convert 16°26'10.5"N 103°30'07.3"E to Decimal
const STORE_LAT = 16.43625;
const STORE_LNG = 103.502028;
const STORE_LOCATION: [number, number] = [STORE_LAT, STORE_LNG];

// Component to handle map movement programmatically
const MapController = ({ center, locateTrigger }: { center: L.LatLngExpression | null, locateTrigger: number }) => {
  const map = useMap();
  
  // FIX: แก้ไขปัญหาแผนที่โหลดไม่สมบูรณ์ (เป็นสีเทาหรือขาดๆหายๆ) เมื่อแสดงใน Modal
  // เหตุผล: Leaflet คำนวณขนาดผิดตอนที่ Modal กำลังเลื่อนขึ้นมา (Animation)
  // วิธีแก้: สั่งให้คำนวณขนาดใหม่ (invalidateSize) หลังจากเวลาผ่านไปเล็กน้อย
  useEffect(() => {
    const timer = setTimeout(() => {
        map.invalidateSize();
    }, 500); // รอ 0.5 วินาทีเพื่อให้ Modal แสดงผลเสร็จสมบูรณ์
    return () => clearTimeout(timer);
  }, [map]);

  // Handle Search Center
  useEffect(() => {
    if (center) {
      map.flyTo(center, 16);
    }
  }, [center, map]);

  // Handle GPS Locate Trigger
  useEffect(() => {
    if (locateTrigger > 0) {
      map.locate({ setView: true, maxZoom: 16 });
    }
  }, [locateTrigger, map]);

  return null;
};

const LocationMarker: React.FC<{ onSelect: (lat: number, lng: number) => void, position: L.LatLng | null }> = ({ onSelect, position }) => {
  const map = useMapEvents({
    click(e) {
      onSelect(e.latlng.lat, e.latlng.lng);
      map.flyTo(e.latlng, map.getZoom());
    },
    locationfound(e) {
      onSelect(e.latlng.lat, e.latlng.lng);
      map.flyTo(e.latlng, 16);
    },
  });

  // Locate user on first load if no initial position
  useEffect(() => {
    if (!position) {
      map.locate();
    }
  }, [map, position]);

  return position === null ? null : (
    <Marker position={position}>
       <Popup>จุดส่งอาหาร (Delivery Point)</Popup>
    </Marker>
  );
};

export const MapPicker: React.FC<MapPickerProps> = ({ onLocationSelect, initialLocation }) => {
  const [position, setPosition] = useState<L.LatLng | null>(
    initialLocation ? new L.LatLng(initialLocation.lat, initialLocation.lng) : null
  );

  // Search State
  const [searchText, setSearchText] = useState('');
  const [mapCenter, setMapCenter] = useState<L.LatLngExpression | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [locateTrigger, setLocateTrigger] = useState(0); // Counter to trigger location

  const handleSelect = (lat: number, lng: number) => {
    const newPos = new L.LatLng(lat, lng);
    setPosition(newPos);
    onLocationSelect({ lat, lng, address: `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}` });
  };

  const performSearch = async () => {
    if (!searchText.trim()) return;
    setIsSearching(true);
    try {
        // Use OpenStreetMap Nominatim API for search
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchText)}&limit=1`);
        const data = await response.json();
        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            setMapCenter([lat, lon]);
        } else {
            alert('ไม่พบสถานที่ (Location not found)');
        }
    } catch (e) {
        console.error("Search error", e);
        alert('เกิดข้อผิดพลาดในการค้นหา');
    } finally {
        setIsSearching(false);
    }
  };

  const handleLocateMe = () => {
      setLocateTrigger(prev => prev + 1);
  };

  return (
    <div className="h-full w-full rounded-lg overflow-hidden border-2 border-orange-200 shadow-inner z-0 relative flex flex-col bg-gray-100">
      
      {/* Search Bar Overlay */}
      <div className="absolute top-2 left-2 right-2 z-[500] flex gap-2 p-1.5 bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-gray-200">
         <div className="relative flex-1">
            <input 
                type="text" 
                placeholder="ค้นหาสถานที่ / Search Location..." 
                className="w-full pl-9 pr-2 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-400 bg-gray-50"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && performSearch()}
            />
            <Search className="absolute left-2.5 top-2.5 text-gray-400" size={16} />
         </div>
         <button 
            onClick={performSearch}
            className="bg-orange-500 hover:bg-orange-600 text-white px-4 rounded-md transition flex items-center justify-center min-w-[3rem]"
            disabled={isSearching}
         >
            {isSearching ? <span className="animate-spin text-xs">⌛</span> : "ค้นหา"}
         </button>
      </div>

      {/* Locate Me Button */}
      <button
          onClick={handleLocateMe}
          className="absolute bottom-8 right-2 z-[500] bg-white p-2 rounded-full shadow-md border border-gray-300 text-gray-700 hover:text-blue-600 hover:border-blue-500 active:scale-95 transition"
          title="ตำแหน่งปัจจุบัน (Current Location)"
      >
          <Crosshair size={24} />
      </button>

      <MapContainer 
        center={STORE_LOCATION} // Default center to store
        zoom={13} 
        scrollWheelZoom={true} 
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {/* Controllers */}
        <MapController center={mapCenter} locateTrigger={locateTrigger} />
        
        {/* User Selection Marker */}
        <LocationMarker onSelect={handleSelect} position={position} />
        
        {/* Fixed Store Marker */}
        <Marker position={STORE_LOCATION}>
           <Popup autoPan={false}>
              <div className="text-center min-w-[120px]">
                 <strong className="text-orange-600 flex items-center gap-1 justify-center mb-1">
                    <Store size={16}/> ร้านอาหารด่วน
                 </strong>
                 <p className="text-xs text-gray-500 m-0">จุดเริ่มต้นส่งอาหาร</p>
                 <p className="text-[10px] text-gray-400 mt-1">{STORE_LAT.toFixed(5)}, {STORE_LNG.toFixed(5)}</p>
              </div>
           </Popup>
        </Marker>
      </MapContainer>
      
      <div className="absolute bottom-0 left-0 right-0 bg-white/90 text-[10px] text-center text-gray-500 py-1 z-[400] border-t border-gray-200">
        *แตะที่แผนที่ หรือกดปุ่มเป้าหมาย เพื่อปักหมุดจุดส่งอาหาร
      </div>
    </div>
  );
};
