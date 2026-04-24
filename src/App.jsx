import React, { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  ComposedChart, Line, Legend
} from 'recharts';
import {
  Sun, Calendar, Settings, AlertCircle, Info, Target, Calculator, Zap, Cloud,
  LogOut, LogIn, User, Plus, Trash2, Activity,
  MapPin, Search, Navigation, LayoutDashboard, TrendingUp, History, CloudRain,
  Crosshair
} from 'lucide-react';

import { useSolarAuth } from './hooks/useSolarAuth';
import { useFirestoreSync } from './hooks/useFirestoreSync';
import { useSolarPhysics } from './hooks/useSolarPhysics';
import { sanitizeString } from './utils/sanitize';

const appId = "solar-forecaster-63320";

export default function App() {
  const { user, authLoading, authError, login, logout } = useSolarAuth();
  const { 
    config, actuals, dbSyncing, dbStatus, lastSynced, 
    saveConfigToCloud, saveActualToCloud 
  } = useFirestoreSync(user, appId);
  const { 
    data, dailyTotals, nowLabel, loading, error, totalCapacity 
  } = useSolarPhysics(config, dbSyncing);

  const [showConfig, setShowConfig] = useState(false);
  const [selectedDayLabel, setSelectedDayLabel] = useState("");
  const [activeTab, setActiveTab] = useState("today"); // 'today', 'forecast', 'history'
  const [addressQuery, setAddressQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [lastSearchTime, setLastSearchTime] = useState(0);
  const [locationMode, setLocationMode] = useState("gps"); // 'gps', 'search', 'plus', 'manual'
  const [manualCoords, setManualCoords] = useState({ lat: 53.3767, long: -6.3286 });

  const detectLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }

    setSearchLoading(true);
    navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude } = position.coords;
      
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
        const data = await res.json();
        const city = data.address.city || data.address.town || data.address.village || data.address.suburb || "Detected Location";
        
        saveConfigToCloud({
          ...config,
          lat: latitude,
          long: longitude,
          locationName: sanitizeString(`${city}, ${data.address.country}`)
        });
      } catch (err) {
        console.error("Reverse geocoding failed:", err);
        // Fallback to coordinates only
        saveConfigToCloud({ ...config, lat: latitude, long: longitude, locationName: "GPS Detected" });
      } finally {
        setSearchLoading(false);
      }
    }, (err) => {
      console.error("GPS Error:", err);
      alert("Unable to retrieve your location. Please check permissions or use manual search.");
      setSearchLoading(false);
    }, { enableHighAccuracy: true });
  };

  const [visibleSeries, setVisibleSeries] = useState({
    total: true,
    energy: true,
    clouds: true,
    strings: true
  });

  const toggleSeries = (key) => {
    setVisibleSeries(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const STRING_COLORS = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

  const maxKw = data.length > 0 ? Math.max(...data.map(d => d.total)) : 0;
  const todayForecast = dailyTotals.find(d => d.dayOffset === 0) || { yield: 0, eastYield: 0, westYield: 0, dayLabel: '' };
  const tomorrowForecast = dailyTotals.find(d => d.dayOffset === 1) || { yield: 0, eastYield: 0, westYield: 0 };

  // --- AUTO-CALIBRATION MATH ---
  let sumActuals = 0;
  let sumModel = 0;
  let daysEntered = 0;

  dailyTotals.forEach(day => {
    const enteredVal = Number(actuals[day.dayLabel]);
    if (enteredVal > 0) {
      sumActuals += enteredVal;
      sumModel += day.yield;
      daysEntered++;
    }
  });

  const accuracyPercentage = sumActuals > 0 ? ((sumModel / sumActuals) * 100).toFixed(1) : 0;
  const isAccurate = Math.abs(100 - accuracyPercentage) < 5;
  let suggestedEff = config.eff;
  if (sumActuals > 0 && sumModel > 0) {
    suggestedEff = Math.min(1.0, Math.max(0.1, config.eff * (sumActuals / sumModel)));
  }
  const canApply = daysEntered > 0 && Math.abs(config.eff - suggestedEff) > 0.001;

  // Selected Day Drill-down init
  useEffect(() => {
    if (!selectedDayLabel && dailyTotals.length > 0) {
      const today = dailyTotals.find(d => d.dayOffset === 0);
      setSelectedDayLabel(today ? today.dayLabel : dailyTotals[0].dayLabel);
    }
  }, [dailyTotals, selectedDayLabel]);

  const searchAddress = async (q) => {
    setAddressQuery(q);
    if (q.length < 3) {
      setSearchResults([]);
      return;
    }
    const now = Date.now();
    if (now - lastSearchTime < 500) return;
    setLastSearchTime(now);
    setSearchLoading(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5`);
      const results = await res.json();
      const mapped = results.map(r => ({
        id: r.place_id,
        name: sanitizeString(r.display_name.split(',')[0] || ""),
        admin1: sanitizeString(r.address.county || r.address.state || ''),
        country: sanitizeString(r.address.country || ''),
        latitude: parseFloat(r.lat),
        longitude: parseFloat(r.lon),
        fullName: sanitizeString(r.display_name)
      }));
      setSearchResults(mapped);
    } catch (err) {
      console.error("Geocoding error:", err);
    } finally {
      setSearchLoading(false);
    }
  };

  const selectLocation = (res) => {
    saveConfigToCloud({ 
      ...config, 
      lat: res.latitude, 
      long: res.longitude,
      locationName: res.name + (res.admin1 ? ', ' + res.admin1 : '')
    });
    setSearchResults([]);
    setAddressQuery("");
  };

  const addString = () => {
    const newString = { id: 's' + Date.now(), name: `String ${config.strings.length + 1}`, azimuth: 180, tilt: 35, count: 10 };
    saveConfigToCloud({ ...config, strings: [...config.strings, newString] });
  };

  const removeString = (id) => {
    if (config.strings.length <= 1) return;
    saveConfigToCloud({ ...config, strings: config.strings.filter(s => s.id !== id) });
  };

  const updateString = (id, field, value) => {
    const updated = config.strings.map(s => s.id === id ? { ...s, [field]: value } : s);
    saveConfigToCloud({ ...config, strings: updated });
  };

  const selectedDayData = data.filter(d => d.dayLabel === selectedDayLabel);
  const currentHourTick = nowLabel && nowLabel.startsWith(selectedDayLabel) ? nowLabel.replace(selectedDayLabel + ' ', '') : null;

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#1a1b23] text-white">
        <div className="text-center">
          <MapPin className="w-12 h-12 mx-auto mb-4 text-indigo-500 animate-pulse" />
          <h2 className="text-xl font-semibold tracking-tight text-slate-400">Authenticating...</h2>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#1a1b23] p-6">
        <div className="max-w-md w-full bg-[#252630] p-8 rounded-2xl border border-slate-700 shadow-2xl text-center">
          <div className="w-20 h-20 bg-indigo-600/20 rounded-full flex items-center justify-center mx-auto mb-6"><Sun className="w-10 h-10 text-indigo-500" /></div>
          <h1 className="text-3xl font-bold text-white mb-3">Solarcaster</h1>
          <p className="text-slate-400 mb-8 leading-relaxed">Dynamic solar forecasting with cloud persistence and model auto-calibration.</p>
          <button onClick={login} className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center justify-center gap-3 transition-all font-bold text-lg shadow-lg"><LogIn className="w-6 h-6" /> Sign in with Google</button>
        </div>
      </div>
    );
  }

  if ((loading || dbSyncing) && data.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#1a1b23] text-white">
        <div className="text-center animate-pulse">
          <Sun className="w-12 h-12 mx-auto mb-4 text-[#fde047] animate-spin-slow" />
          <h2 className="text-xl font-semibold text-slate-400">Loading Solar Physics...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1b23] font-sans text-slate-200 pb-24 md:pb-6 overflow-x-hidden">
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">

        {/* HEADER */}
        <div className="flex justify-between items-center gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">Solarcaster<Cloud className="w-4 h-4 md:w-5 md:h-5 text-emerald-400 ml-2" aria-label="Cloud sync active" /></h1>
            <p className="text-slate-400 text-[10px] md:text-sm mt-1 flex items-center gap-1"><MapPin className="w-3 h-3 text-indigo-400" aria-hidden="true" /> {config.locationName || `${config.lat?.toFixed(2)}°N, ${config.long?.toFixed(2)}°W`}</p>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <button onClick={() => setShowConfig(!showConfig)} className={`relative p-2 md:px-4 md:py-2 bg-[#252630] hover:bg-[#2d2e3a] border ${canApply ? 'border-amber-500/50 text-amber-400' : 'border-slate-700 text-slate-300'} rounded-lg flex items-center gap-2 transition-colors text-sm font-medium shadow-sm`}>
              {canApply ? <Activity className="w-4 h-4 animate-pulse" /> : <Settings className="w-4 h-4" />}
              <span className="hidden md:inline">Parameters</span>
              {canApply && <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full border-2 border-[#1a1b23]"></span>}
            </button>
            <div className="flex items-center gap-2 bg-[#252630] p-1 md:pr-3 rounded-full border border-slate-700 shadow-sm">
              {user.photoURL ? <img src={user.photoURL} alt="Profile" className="w-7 h-7 md:w-8 md:h-8 rounded-full border border-slate-600" /> : <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-slate-700 flex items-center justify-center"><User className="w-3 h-3 md:w-4 md:h-4 text-slate-400" /></div>}
              <button onClick={logout} className="hidden md:block text-slate-400 hover:text-white transition-colors ml-1"><LogOut className="w-4 h-4" /></button>
            </div>
          </div>
        </div>

        {/* DESKTOP TOP NAV */}
        <div className="hidden md:flex items-center gap-1 p-1 bg-[#252630] rounded-xl border border-slate-800 w-fit">
          <button onClick={() => setActiveTab('today')} className={`px-6 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'today' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>Today</button>
          <button onClick={() => setActiveTab('forecast')} className={`px-6 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'forecast' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>7-Day Forecast</button>
          <button onClick={() => setActiveTab('history')} className={`px-6 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'history' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>History</button>
        </div>

        {showConfig && (
          <div className="bg-[#252630] p-5 rounded-xl border border-slate-700 shadow-lg animate-in fade-in slide-in-from-top-4 space-y-6">

            {/* LOCATION HUB */}
            <div className="space-y-4 pb-6 border-b border-slate-700/50">
              <div className="flex items-center justify-between">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-2">
                  <MapPin className="w-3 h-3" /> System Location
                </h4>
                <div className="flex bg-[#1a1b23] p-0.5 rounded-lg border border-slate-800">
                  {['gps', 'search', 'plus', 'manual'].map(mode => (
                    <button 
                      key={mode} 
                      onClick={() => setLocationMode(mode)}
                      className={`px-2 py-1 text-[8px] font-black uppercase rounded-md transition-all ${locationMode === mode ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {locationMode === 'gps' && (
                <div className="animate-in fade-in slide-in-from-left-2">
                  <button 
                    onClick={detectLocation}
                    disabled={searchLoading}
                    className="w-full py-4 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/30 rounded-xl flex flex-col items-center justify-center gap-2 transition-all group"
                  >
                    <Crosshair className={`w-8 h-8 ${searchLoading ? 'animate-spin text-indigo-400' : 'text-indigo-500 group-hover:scale-110 transition-transform'}`} />
                    <span className="text-xs font-black text-indigo-400 uppercase tracking-widest">
                      {searchLoading ? "DetectingRoof..." : "Use Current GPS Location"}
                    </span>
                  </button>
                </div>
              )}

              {locationMode === 'search' && (
                <div className="relative animate-in fade-in slide-in-from-left-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input 
                    type="text" 
                    value={addressQuery}
                    onChange={(e) => searchAddress(e.target.value)}
                    placeholder="Search address, Eircode, or city..."
                    className="w-full pl-10 pr-4 py-2.5 bg-[#1a1b23] border border-slate-600 rounded-lg text-sm text-white focus:border-indigo-500 outline-none"
                  />
                  {searchLoading && <Activity className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-500 animate-spin" />}
                  {searchResults.length > 0 && (
                    <div className="absolute z-50 mt-2 w-full bg-[#1a1b23] border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                      {searchResults.map((res) => (
                        <button key={res.id} onClick={() => selectLocation(res)} className="w-full px-4 py-3 text-left text-sm text-slate-300 hover:bg-indigo-600/20 hover:text-white border-b border-slate-800 last:border-0 transition-colors flex items-center gap-3">
                          <Navigation className="w-3 h-3 text-indigo-400" />
                          <div>
                            <div className="font-bold">{res.name}</div>
                            <div className="text-[10px] text-slate-500">{res.admin1 ? res.admin1 + ', ' : ''}{res.country}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {locationMode === 'plus' && (
                <div className="space-y-2 animate-in fade-in slide-in-from-left-2">
                  <div className="relative">
                    <Zap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400" />
                    <input 
                      type="text" 
                      placeholder="Paste Google Plus Code (e.g. 8FWM7W3R+GV)"
                      onBlur={(e) => { if(e.target.value) searchAddress(e.target.value); }}
                      className="w-full pl-10 pr-4 py-2.5 bg-[#1a1b23] border border-slate-600 rounded-lg text-sm text-white focus:border-indigo-500 outline-none"
                    />
                  </div>
                  <p className="text-[9px] text-slate-500 leading-tight">Pro tip: Plus Codes work globally and are found in Google Maps "Dropped Pin" info.</p>
                </div>
              )}

              {locationMode === 'manual' && (
                <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-left-2">
                  <div>
                    <label className="block text-[9px] font-bold text-slate-600 uppercase mb-1">Latitude</label>
                    <input 
                      type="number" 
                      value={manualCoords.lat}
                      onChange={(e) => setManualCoords({ ...manualCoords, lat: parseFloat(e.target.value) })}
                      className="w-full px-3 py-2 bg-[#1a1b23] border border-slate-600 rounded-lg text-sm text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-600 uppercase mb-1">Longitude</label>
                    <input 
                      type="number" 
                      value={manualCoords.long}
                      onChange={(e) => setManualCoords({ ...manualCoords, long: parseFloat(e.target.value) })}
                      className="w-full px-3 py-2 bg-[#1a1b23] border border-slate-600 rounded-lg text-sm text-white font-mono"
                    />
                  </div>
                  <button 
                    onClick={() => selectLocation({ latitude: manualCoords.lat, longitude: manualCoords.long, name: "Manual Location", country: "User Set" })}
                    className="col-span-2 py-2 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 text-[10px] font-bold rounded-lg border border-indigo-500/30 transition-all"
                  >
                    APPLY COORDINATES
                  </button>
                </div>
              )}

              <div className="flex items-center gap-4 text-[10px] text-slate-400 font-mono bg-[#1a1b23] p-2 rounded-lg border border-slate-800/50">
                <div className="flex items-center gap-1"><span className="text-slate-600">LAT:</span> <span className="text-white">{config.lat?.toFixed(4)}</span></div>
                <div className="flex items-center gap-1"><span className="text-slate-600">LON:</span> <span className="text-white">{config.long?.toFixed(4)}</span></div>
                {config.locationName && <div className="ml-auto text-indigo-400 italic truncate max-w-[150px]">{config.locationName}</div>}
              </div>
            </div>

            <div className="flex justify-between items-center border-b border-slate-700 pb-4">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2"><Calculator className="w-4 h-4 text-amber-400" /> String Configuration</h3>              <div className="flex items-center gap-4"><div className="flex items-center gap-2"><label className="text-[10px] text-slate-400 uppercase font-bold">Eff.</label><input type="number" value={config.eff * 100} onChange={e => saveConfigToCloud({ ...config, eff: Number(e.target.value) / 100 })} className="w-14 p-1 bg-[#1a1b23] border border-slate-600 rounded text-white text-xs font-mono" /></div><button onClick={addString} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-bold flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(config.strings || []).map((s, idx) => (
                <div key={s.id} className="p-4 bg-[#1a1b23] rounded-lg border border-slate-700 relative group"><button onClick={() => removeString(s.id)} className="absolute top-2 right-2 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-4 h-4" /></button><div className="grid grid-cols-2 gap-3"><div className="col-span-2"><input type="text" value={s.name} onChange={e => updateString(s.id, 'name', e.target.value)} className="w-full bg-transparent border-b border-slate-700 focus:border-indigo-500 outline-none text-sm font-bold text-white py-1" /></div><div><label className="block text-[9px] font-bold text-slate-500 uppercase">Panels</label><input type="number" value={s.count} onChange={e => updateString(s.id, 'count', Number(e.target.value))} className="w-full bg-[#252630] border border-slate-700 rounded px-2 py-1 text-sm text-white" /></div><div><label className="block text-[9px] font-bold text-slate-500 uppercase">Azimuth</label><input type="number" value={s.azimuth} onChange={e => updateString(s.id, 'azimuth', Number(e.target.value))} className="w-full bg-[#252630] border border-slate-700 rounded px-2 py-1 text-sm text-white" /></div></div></div>
              ))}
            </div>
            <div className="pt-4 border-t border-slate-700/50 flex justify-between items-center text-xs text-slate-400"><p>Capacity: <strong className="text-white text-sm">{totalCapacity.toFixed(2)} kWp</strong></p><button onClick={logout} className="text-red-400 hover:underline md:hidden">Log Out</button></div>
            <div className="p-2 bg-slate-900/50 rounded border border-slate-800 text-[9px] font-mono text-slate-600"><p>UID: {user?.uid}</p><p>DB: {dbStatus} | Sync: {lastSynced || "Never"}</p></div>
          </div>
        )}

        {/* MAIN TABS */}
        {activeTab === 'today' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-[#252630] p-5 rounded-xl border border-slate-700/50 shadow-sm flex flex-col justify-between">
                <div><p className="text-slate-400 text-sm font-medium mb-1">Forecast Today</p><div className="flex items-end gap-2"><h2 className="text-3xl font-bold text-white">{todayForecast.yield.toFixed(1)}</h2><span className="text-slate-500 mb-1 font-medium">kWh</span></div></div>
                <div className="mt-4 space-y-1">
                  {(config.strings || []).map((s, idx) => (<div key={s.id} className="flex items-center gap-2 text-[10px] text-slate-500"><div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STRING_COLORS[idx % STRING_COLORS.length] }}></div><span className="truncate flex-1">{s.name}:</span><span className="font-mono">{(todayForecast.strings?.[s.id] || 0).toFixed(1)}</span></div>))}
                </div>
              </div>
              <div className="bg-gradient-to-br from-[#1e293b] to-[#0f172a] p-5 rounded-xl border border-indigo-500/30 shadow-sm flex flex-col justify-between">
                <div><label className="text-indigo-300 text-sm font-medium mb-1 flex items-center gap-2"><Zap className="w-4 h-4 text-indigo-400" /> Today's Actual</label><div className="mt-2 flex items-center gap-2"><input type="number" value={actuals[todayForecast.dayLabel] || ''} onChange={e => saveActualToCloud(todayForecast.dayLabel, e.target.value)} className="w-full bg-transparent border-b-2 border-indigo-500 p-1 text-3xl font-bold text-white outline-none" step="0.1" placeholder="0.0" /><span className="text-slate-500 font-medium text-xs">kWh</span></div></div>
                <p className="mt-4 text-[10px] text-slate-500 leading-tight italic">Syncs to cloud for model tuning.</p>
              </div>
              <div className={`p-5 rounded-xl border shadow-sm flex flex-col justify-between ${daysEntered > 0 ? (isAccurate ? 'bg-emerald-900/10 border-emerald-500/20' : 'bg-amber-900/10 border-amber-500/20') : 'bg-[#252630] border-slate-700/50'}`}>
                <div><p className="text-slate-400 text-sm font-medium mb-1 flex items-center gap-2"><Target className="w-4 h-4" /> Calibration</p>{daysEntered > 0 ? <div className="flex items-end gap-2 mt-2"><h2 className={`text-3xl font-bold ${isAccurate ? 'text-emerald-400' : 'text-amber-400'}`}>{accuracyPercentage}%</h2><span className="text-[10px] text-slate-500 mb-1 uppercase">Accuracy</span></div> : <p className="text-slate-500 text-xs mt-3">Enter data to tune model.</p>}</div>
                {canApply && <button onClick={() => saveConfigToCloud({ ...config, eff: suggestedEff })} className="mt-3 w-full py-1.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">APPLY {(suggestedEff * 100).toFixed(1)}% EFF</button>}
              </div>
              <div className="hidden md:flex bg-[#252630] p-5 rounded-xl border border-slate-700/50 shadow-sm flex-col justify-between"><div><p className="text-slate-400 text-sm font-medium mb-1">Forecast Tomorrow</p><div className="flex items-end gap-2"><h2 className="text-3xl font-bold text-white">{tomorrowForecast.yield.toFixed(1)}</h2><span className="text-slate-500 mb-1 font-medium">kWh</span></div></div><div className="mt-4 flex items-center gap-2 text-[10px] text-slate-500"><Calendar className="w-3 h-3 text-blue-400" /> 24h Prediction</div></div>
            </div>
            <div className="bg-[#252630] p-4 md:p-6 rounded-2xl border border-slate-700/50 shadow-lg">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2"><Activity className="w-5 h-5 text-indigo-400" /> Hourly Profile</h2>
                <div className="flex flex-wrap gap-2">{['clouds', 'total', 'energy', 'strings'].map(key => (<button key={key} onClick={() => toggleSeries(key)} className={`px-2 py-1 rounded text-[9px] font-bold uppercase border transition-all ${visibleSeries[key] ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-transparent border-slate-800 text-slate-600'}`}>{key}</button>))}</div>
              </div>
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%"><ComposedChart data={selectedDayData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" /><XAxis dataKey="timeLabel" interval={3} stroke="#64748b" fontSize={11} axisLine={false} tickLine={false} /><YAxis stroke="#64748b" fontSize={11} axisLine={false} tickLine={false} /><YAxis yAxisId="right" orientation="right" stroke="#818cf8" fontSize={10} axisLine={false} tickLine={false} unit="kWh" />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} content={({ active, payload, label }) => {
                      if (active && payload && payload.length) return (<div className="bg-[#1e293b] border border-slate-700 p-3 rounded-lg shadow-xl text-[10px] space-y-1"><p className="font-bold text-slate-400 mb-1">{label}</p>{payload.map((entry, idx) => (<div key={idx} className="flex justify-between gap-4"><span style={{ color: entry.color }}>{entry.name}:</span><span className="text-white font-mono">{entry.value} {entry.dataKey === 'cumulativeYield' ? 'kWh' : (entry.dataKey === 'cloudCover' ? '%' : 'kW')}</span></div>))}</div>); return null;
                    }} />
                    {visibleSeries.clouds && <Area yAxisId="right" type="monotone" dataKey="cloudCover" name="Cloud %" stroke="none" fill="#475569" fillOpacity={0.1} />}
                    {visibleSeries.total && <Area type="monotone" dataKey="total" name="Total Power" stroke="#fde047" fill="#fde047" fillOpacity={0.1} strokeWidth={2} />}
                    {visibleSeries.strings && (config.strings || []).map((s, idx) => <Line key={s.id} type="monotone" dataKey={`stringPowers.${s.id}`} name={s.name} stroke={STRING_COLORS[idx % STRING_COLORS.length]} strokeWidth={1} dot={false} strokeDasharray="5 5" />)}
                    {visibleSeries.energy && <Line yAxisId="right" type="monotone" dataKey="cumulativeYield" name="Energy" stroke="#818cf8" strokeWidth={3} dot={false} />}
                    {currentHourTick && <ReferenceLine x={currentHourTick} stroke="#818cf8" strokeDasharray="4 4" />}
                  </ComposedChart></ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* --- FORECAST VIEW --- */}
        {activeTab === 'forecast' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 pb-8">
            <div className="bg-[#252630] p-6 rounded-2xl border border-slate-700/50 shadow-lg">
              <h2 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-indigo-400" />
                7-Day Yield Outlook
              </h2>
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                    <defs><linearGradient id="colorYellow" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#fde047" stopOpacity={0.4} /><stop offset="95%" stopColor="#fde047" stopOpacity={0.0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                    <XAxis dataKey="fullLabel" tickFormatter={(val) => val.split(' ')[0]} interval={23} stroke="#64748b" fontSize={11} axisLine={false} tickLine={false} />
                    <YAxis stroke="#64748b" fontSize={11} domain={[0, Math.ceil(maxKw)]} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} />
                    <Area type="monotone" dataKey="total" name="Total kW" stroke="#fde047" fill="url(#colorYellow)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Daily Summary List (Highly Optimized for Mobile) */}
            <div className="grid grid-cols-1 gap-3">
              {dailyTotals.filter(d => d.dayOffset >= 0).map((day) => {
                const maxWeekYield = Math.max(...dailyTotals.map(d => d.yield));
                const relScale = (day.yield / maxWeekYield) * 100;
                const isVerySunny = day.yield > (maxWeekYield * 0.8);
                const isCloudy = day.yield < (maxWeekYield * 0.4);

                return (
                  <div key={day.dayLabel} className="bg-[#252630] p-4 rounded-2xl border border-slate-800 flex items-center gap-4 transition-transform active:scale-[0.98]">
                    <div className="text-center min-w-[56px] border-r border-slate-800 pr-4">
                      <div className="text-[10px] text-slate-500 uppercase font-black tracking-widest">{day.date.toLocaleDateString([], { weekday: 'short' })}</div>
                      <div className="text-xl font-black text-white">{day.date.toLocaleDateString([], { day: 'numeric' })}</div>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-end mb-1.5">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Predicted</span>
                        <span className="text-sm font-black text-white">{day.yield.toFixed(1)} <span className="text-[10px] text-slate-500 font-normal">kWh</span></span>
                      </div>
                      <div className="h-2 w-full bg-slate-800/50 rounded-full overflow-hidden border border-slate-700/30">
                        <div 
                          className={`h-full rounded-full transition-all duration-1000 ${isVerySunny ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]' : 'bg-indigo-500'}`} 
                          style={{ width: `${relScale}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="pl-2">
                      {isVerySunny ? (
                        <Sun className="w-6 h-6 text-amber-400 drop-shadow-md" />
                      ) : isCloudy ? (
                        <CloudRain className="w-6 h-6 text-slate-500" />
                      ) : (
                        <Cloud className="w-6 h-6 text-indigo-400/60" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-[#252630] rounded-2xl border border-slate-700/50 overflow-hidden shadow-lg animate-in fade-in slide-in-from-bottom-2">
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-[#1e293b]/50 border-b border-slate-700"><tr className="text-slate-400 uppercase text-[10px] font-bold"><th className="p-4">Date</th><th className="p-4">Model</th><th className="p-4 text-indigo-400">Actual</th></tr></thead><tbody className="text-slate-300 divide-y divide-slate-700/50">{dailyTotals.map((day, i) => (<tr key={i} className="hover:bg-[#2d2e3a] transition-colors"><td className="p-4 font-medium text-xs whitespace-nowrap">{day.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</td><td className="p-4 font-bold text-white text-xs">{day.yield.toFixed(2)} kWh</td><td className="p-4"><input type="number" value={actuals[day.dayLabel] || ''} onChange={e => saveActualToCloud(day.dayLabel, e.target.value)} className="w-16 h-8 bg-[#1a1b23] border border-slate-600 rounded px-2 text-white text-xs" /></td></tr>))}</tbody></table></div>
          </div>
        )}

        {/* MOBILE BOTTOM NAV */}
        <div className="fixed bottom-0 left-0 right-0 h-16 bg-[#1a1b23]/95 backdrop-blur-md border-t border-slate-800 flex md:hidden items-center justify-around px-6 z-50 pb-safe">
           <button onClick={() => setActiveTab('today')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'today' ? 'text-indigo-400' : 'text-slate-600'}`}><LayoutDashboard className="w-5 h-5" /><span className="text-[9px] font-bold uppercase tracking-tighter">Today</span></button>
           <button onClick={() => setActiveTab('forecast')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'forecast' ? 'text-indigo-400' : 'text-slate-600'}`}><TrendingUp className="w-5 h-5" /><span className="text-[9px] font-bold uppercase tracking-tighter">Forecast</span></button>
           <button onClick={() => setActiveTab('history')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'history' ? 'text-indigo-400' : 'text-slate-600'}`}><History className="w-5 h-5" /><span className="text-[9px] font-bold uppercase tracking-tighter">History</span></button>
        </div>

      </div>
    </div>
  );
}
