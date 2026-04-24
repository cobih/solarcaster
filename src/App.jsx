import React, { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  ComposedChart, Line, Legend
} from 'recharts';
import {
  Sun, Calendar, Settings, AlertCircle, Info, Target, Calculator, Zap, Cloud,
  LogOut, LogIn, User, Plus, Trash2, Activity,
  MapPin, Search, Navigation, LayoutDashboard, TrendingUp, History, CloudRain,
  Crosshair, ChevronDown, ChevronUp, MessageSquare, ArrowRight
} from 'lucide-react';

import { useSolarAuth } from './hooks/useSolarAuth';
import { useFirestoreSync } from './hooks/useFirestoreSync';
import { useSolarPhysics } from './hooks/useSolarPhysics';
import { sanitizeString } from './utils/sanitize';
import { db, logAnalyticsEvent } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

const appId = "solar-forecaster-63320";

export default function App() {
  const { user, authLoading, login, logout } = useSolarAuth();
  const { 
    config, actuals, dbSyncing, dbStatus, lastSynced, 
    saveConfigToCloud, saveActualToCloud, publishForecast 
  } = useFirestoreSync(user, appId);
  
  const { 
    data, dailyTotals, nowLabel, loading, error, totalCapacity 
  } = useSolarPhysics(config, dbSyncing);

  const [showConfig, setShowConfig] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [showForecastChart, setShowForecastChart] = useState(false);
  const [selectedDayLabel, setSelectedDayLabel] = useState("");
  const [expandedForecastDay, setExpandedForecastDay] = useState(null);
  const [activeTab, setActiveTab] = useState("today"); // 'today', 'forecast', 'history'
  
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [addressQuery, setAddressQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [lastSearchTime, setLastSearchTime] = useState(0);
  const [locationMode, setLocationMode] = useState("gps");
  const [manualCoords, setManualCoords] = useState({ lat: 53.3767, long: -6.3286 });

  const [visibleSeries, setVisibleSeries] = useState({
    total: true,
    energy: true,
    clouds: true,
    strings: true
  });

  const STRING_COLORS = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

  // --- ANALYTICS ---
  useEffect(() => {
    logAnalyticsEvent('screen_view', { screen_name: activeTab });
  }, [activeTab]);

  useEffect(() => {
    if (user) {
      logAnalyticsEvent('login', { method: 'google' });
    }
  }, [user?.uid]);

  useEffect(() => {
    if (config.apiEnabled && dailyTotals.length > 0) {
      publishForecast(dailyTotals);
    }
  }, [dailyTotals, config.apiEnabled, publishForecast]);

  const toggleSeries = (key) => {
    setVisibleSeries(prev => ({ ...prev, [key]: !prev[key] }));
    logAnalyticsEvent('toggle_series', { series: key, visible: !visibleSeries[key] });
  };

  const maxKw = data.length > 0 ? Math.max(...data.map(d => d.total)) : 0;
  const todayForecast = dailyTotals.find(d => d.dayOffset === 0) || { yield: 0, eastYield: 0, westYield: 0, dayLabel: '', strings: {} };
  const tomorrowForecast = dailyTotals.find(d => d.dayOffset === 1) || { yield: 0, eastYield: 0, westYield: 0 };

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

  useEffect(() => {
    if (!selectedDayLabel && dailyTotals.length > 0) {
      const today = dailyTotals.find(d => d.dayOffset === 0);
      setSelectedDayLabel(today ? today.dayLabel : dailyTotals[0].dayLabel);
    }
  }, [dailyTotals, selectedDayLabel]);

  const searchAddress = async (q) => {
    setAddressQuery(q);
    if (q.length < 3) { setSearchResults([]); return; }
    const now = Date.now();
    if (now - lastSearchTime < 500) return;
    setLastSearchTime(now);
    setSearchLoading(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5`);
      const results = await res.json();
      setSearchResults(results.map(r => ({
        id: r.place_id,
        name: sanitizeString(r.display_name.split(',')[0] || ""),
        admin1: sanitizeString(r.address.county || r.address.state || ''),
        country: sanitizeString(r.address.country || ''),
        latitude: parseFloat(r.lat),
        longitude: parseFloat(r.lon),
        fullName: sanitizeString(r.display_name)
      })));
    } catch (err) { console.error(err); } finally { setSearchLoading(false); }
  };

  const detectLocation = () => {
    if (!navigator.geolocation) return alert("No GPS");
    setSearchLoading(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`);
        const d = await res.json();
        saveConfigToCloud({ ...config, lat: pos.coords.latitude, long: pos.coords.longitude, locationName: sanitizeString(`${d.address.city || d.address.town}, ${d.address.country}`), locationSet: true });
      } catch (e) {
        saveConfigToCloud({ ...config, lat: pos.coords.latitude, long: pos.coords.longitude, locationName: "GPS Detected", locationSet: true });
      } finally { setSearchLoading(false); }
    }, () => setSearchLoading(false));
  };

  const selectLocation = (res) => {
    saveConfigToCloud({ ...config, lat: res.latitude, long: res.longitude, locationName: res.name + (res.admin1 ? ', ' + res.admin1 : ''), locationSet: true });
    setSearchResults([]); setAddressQuery("");
  };

  const submitFeedback = async () => {
    if (!feedbackText.trim() || !user) return;
    setIsSubmittingFeedback(true);
    try {
      await addDoc(collection(db, 'feedback'), { userId: user.uid, userEmail: user.email, text: sanitizeString(feedbackText), timestamp: serverTimestamp(), appId });
      const subject = encodeURIComponent(`Solarcaster Feedback`);
      window.location.href = `mailto:cobih.obih+solarcaster@gmail.com?subject=${subject}&body=${encodeURIComponent(feedbackText)}`;
      setFeedbackText(""); setShowFeedback(false);
    } catch (err) { alert("Failed"); } finally { setIsSubmittingFeedback(false); }
  };

  const addString = () => {
    const s = { id: 's' + Date.now(), name: `String ${config.strings.length + 1}`, azimuth: 180, tilt: 35, count: 10, wattage: 465 };
    saveConfigToCloud({ ...config, strings: [...config.strings, s] });
  };

  const removeString = (id) => saveConfigToCloud({ ...config, strings: config.strings.filter(s => s.id !== id) });
  const updateString = (id, f, v) => saveConfigToCloud({ ...config, strings: config.strings.map(s => s.id === id ? { ...s, [f]: v } : s) });

  const selectedDayData = data.filter(d => d.dayLabel === selectedDayLabel);
  const currentHourTick = nowLabel && nowLabel.startsWith(selectedDayLabel) ? nowLabel.replace(selectedDayLabel + ' ', '') : null;

  if (authLoading) return <div className="flex items-center justify-center h-screen bg-[#1a1b23] text-white"><MapPin className="w-12 h-12 text-indigo-500 animate-pulse" /></div>;
  
  if (!user) return (
    <div className="flex items-center justify-center min-h-screen bg-[#1a1b23] p-6 text-center">
      <div className="max-w-md w-full bg-[#252630] p-8 rounded-2xl border border-slate-700 shadow-2xl">
        <Sun className="w-12 h-12 text-indigo-500 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-white mb-2">Solarcaster</h1>
        <p className="text-slate-400 mb-8">Personalized solar forecasting and auto-calibration.</p>
        <button onClick={login} className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold shadow-lg">Sign in with Google</button>
      </div>
    </div>
  );

  if (!config.locationSet || !config.arraysSet) return (
    <div className="min-h-screen bg-[#1a1b23] p-6 flex items-center justify-center">
      <div className="max-w-xl w-full space-y-8 animate-in fade-in zoom-in-95">
        <div className="text-center"><h2 className="text-3xl font-black text-white">Calibration</h2><p className="text-slate-400 mt-2">{onboardingStep === 1 ? "Step 1: Location" : "Step 2: Arrays"}</p></div>
        <div className="bg-[#252630] p-6 rounded-3xl border border-slate-700 shadow-2xl space-y-6">
          {onboardingStep === 1 ? (
            <div className="space-y-6">
              <div className="flex bg-[#1a1b23] p-1 rounded-xl border border-slate-800">{['gps', 'search', 'manual'].map(m => (<button key={m} onClick={() => setLocationMode(m)} className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${locationMode === m ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}>{m}</button>))}</div>
              {locationMode === 'gps' && (<button onClick={detectLocation} className="w-full py-12 bg-indigo-600/10 border-2 border-dashed border-indigo-500/30 rounded-2xl flex flex-col items-center gap-4 transition-all group"><Crosshair className="w-12 h-12 text-indigo-500 group-hover:scale-110" /><span className="text-sm font-bold text-indigo-400 uppercase tracking-widest">{searchLoading ? "Locating..." : "Use Current GPS"}</span></button>)}
              {locationMode === 'search' && (<div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" value={addressQuery} onChange={(e) => searchAddress(e.target.value)} placeholder="Address or city..." className="w-full pl-12 pr-4 py-4 bg-[#1a1b23] border border-slate-600 rounded-2xl text-white focus:border-indigo-500 outline-none" />{searchResults.length > 0 && (<div className="absolute z-50 mt-2 w-full bg-[#1a1b23] border border-slate-700 rounded-2xl overflow-hidden">{searchResults.map(r => (<button key={r.id} onClick={() => selectLocation(r)} className="w-full px-5 py-4 text-left hover:bg-indigo-600/20 border-b border-slate-800 last:border-0 flex items-center gap-4 text-white font-bold">{r.name}</button>))}</div>)}</div>)}
              {locationMode === 'manual' && (<div className="grid grid-cols-2 gap-4"><div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">Lat</label><input type="number" value={manualCoords.lat} onChange={e => setManualCoords({...manualCoords, lat: parseFloat(e.target.value)})} className="w-full px-4 py-3 bg-[#1a1b23] border border-slate-600 rounded-xl text-white" /></div><div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">Long</label><input type="number" value={manualCoords.long} onChange={e => setManualCoords({...manualCoords, long: parseFloat(e.target.value)})} className="w-full px-4 py-3 bg-[#1a1b23] border border-slate-600 rounded-xl text-white" /></div><button onClick={() => selectLocation({ latitude: manualCoords.lat, longitude: manualCoords.long, name: "Manual" })} className="col-span-2 py-4 bg-indigo-600 text-white font-bold rounded-2xl">APPLY</button></div>)}
              {config.locationSet && (<button onClick={() => setOnboardingStep(2)} className="w-full py-4 bg-indigo-600 text-white font-black rounded-2xl flex items-center justify-center gap-2 shadow-xl animate-bounce">Next: Setup Arrays <ArrowRight className="w-5 h-5" /></button>)}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex justify-between items-center"><h3 className="text-sm font-bold text-white uppercase">Define Strings</h3><button onClick={addString} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black">+ Add</button></div>
              <div className="max-h-[300px] overflow-y-auto space-y-3">{config.strings.map(s => (<div key={s.id} className="p-4 bg-[#1a1b23] rounded-2xl border border-slate-700 relative"><button onClick={() => removeString(s.id)} className="absolute top-3 right-3 text-slate-600 hover:text-red-400"><Trash2 className="w-4 h-4" /></button><div className="grid grid-cols-2 gap-4"><div className="col-span-2"><input type="text" value={s.name} onChange={e => updateString(s.id, 'name', e.target.value)} className="w-full bg-transparent border-b border-slate-800 text-white font-bold" /></div><div><label className="text-[9px] font-black text-slate-500 uppercase">Panels</label><input type="number" value={s.count} onChange={e => updateString(s.id, 'count', Number(e.target.value))} className="w-full bg-[#252630] border border-slate-700 rounded-lg p-2 text-white" /></div><div><label className="text-[9px] font-black text-slate-500 uppercase">Pitch</label><input type="number" value={s.tilt} onChange={e => updateString(s.id, 'tilt', Number(e.target.value))} className="w-full bg-[#252630] border border-slate-700 rounded-lg p-2 text-white" /></div></div></div>))}</div>
              {config.strings.length > 0 && (<div className="space-y-4"><button onClick={() => saveConfigToCloud({ ...config, arraysSet: true })} className="w-full py-5 bg-emerald-600 text-white font-black rounded-2xl shadow-xl">FINISH CALIBRATION</button><button onClick={() => setOnboardingStep(1)} className="w-full text-[10px] text-slate-600 font-bold uppercase">Back</button></div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if ((loading || dbSyncing) && data.length === 0) return <div className="flex items-center justify-center h-screen bg-[#1a1b23] text-white"><div className="text-center animate-pulse"><Sun className="w-12 h-12 text-[#fde047] mx-auto mb-4" /><h2 className="text-xl font-semibold text-slate-400">Loading Solar Physics...</h2></div></div>;

  return (
    <div className="min-h-screen bg-[#1a1b23] font-sans text-slate-200 pb-24 md:pb-6 overflow-x-hidden">
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex justify-between items-center gap-4">
          <div><h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">Solarcaster<Cloud className="w-4 h-4 md:w-5 md:h-5 text-emerald-400 ml-2" /></h1><p className="text-slate-400 text-[10px] md:text-sm mt-1 flex items-center gap-1"><MapPin className="w-3 h-3 text-indigo-400" /> {config.locationName || `${config.lat?.toFixed(2)}°N`}</p></div>
          <div className="flex items-center gap-2 md:gap-3">
            <button onClick={() => setShowConfig(!showConfig)} className={`relative p-2 md:px-4 md:py-2 bg-[#252630] border ${canApply ? 'border-amber-500 text-amber-400' : 'border-slate-700 text-slate-300'} rounded-lg flex items-center gap-2 shadow-sm`}>{canApply ? <Activity className="w-4 h-4 animate-pulse" /> : <Settings className="w-4 h-4" />}<span className="hidden md:inline">Parameters</span>{canApply && <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full border-2 border-[#1a1b23]"></span>}</button>
            <button onClick={() => setShowFeedback(true)} className="p-2 md:px-4 md:py-2 bg-indigo-600/10 border border-indigo-500/30 text-indigo-400 rounded-lg flex items-center gap-2 shadow-sm"><MessageSquare className="w-4 h-4" /><span className="hidden md:inline">Feedback</span></button>
            <div className="flex items-center gap-2 bg-[#252630] p-1 md:pr-3 rounded-full border border-slate-700">
              {user.photoURL ? <img src={user.photoURL} alt="P" className="w-7 h-7 md:w-8 md:h-8 rounded-full" /> : <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-slate-700 flex items-center justify-center"><User className="w-3 h-3 md:w-4 md:h-4 text-slate-400" /></div>}
              <button onClick={logout} className="hidden md:block text-slate-400 hover:text-white ml-1"><LogOut className="w-4 h-4" /></button>
            </div>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-1 p-1 bg-[#252630] rounded-xl border border-slate-800 w-fit">
          <button onClick={() => setActiveTab('today')} className={`px-6 py-2 text-sm font-bold rounded-lg ${activeTab === 'today' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>Today</button>
          <button onClick={() => setActiveTab('forecast')} className={`px-6 py-2 text-sm font-bold rounded-lg ${activeTab === 'forecast' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>7-Day Forecast</button>
          <button onClick={() => setActiveTab('history')} className={`px-6 py-2 text-sm font-bold rounded-lg ${activeTab === 'history' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>History</button>
        </div>

        {showConfig && (
          <div className="bg-[#252630] p-5 rounded-xl border border-slate-700 shadow-lg animate-in fade-in slide-in-from-top-4 space-y-6">
            <div className="space-y-4 pb-6 border-b border-slate-700/50">
              <div className="flex items-center justify-between"><h4 className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-2"><MapPin className="w-3 h-3" /> System Location</h4><div className="flex bg-[#1a1b23] p-0.5 rounded-lg border border-slate-800">{['gps', 'search', 'manual'].map(m => (<button key={m} onClick={() => setLocationMode(m)} className={`px-2 py-1 text-[8px] font-black uppercase rounded-md ${locationMode === m ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}>{m}</button>))}</div></div>
              {locationMode === 'gps' && (<div className="animate-in fade-in slide-in-from-left-2"><button onClick={detectLocation} disabled={searchLoading} className="w-full py-4 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/30 rounded-xl flex flex-col items-center justify-center gap-2 group"><Crosshair className={`w-8 h-8 ${searchLoading ? 'animate-spin' : 'group-hover:scale-110'}`} /><span className="text-xs font-black uppercase">{searchLoading ? "Detecting..." : "Use Current GPS"}</span></button></div>)}
              {locationMode === 'search' && (<div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" /><input type="text" value={addressQuery} onChange={e => searchAddress(e.target.value)} placeholder="Search address..." className="w-full pl-10 pr-4 py-2.5 bg-[#1a1b23] border border-slate-600 rounded-lg text-sm text-white outline-none" />{searchResults.length > 0 && (<div className="absolute z-50 mt-2 w-full bg-[#1a1b23] border border-slate-700 rounded-xl shadow-2xl overflow-hidden">{searchResults.map(r => (<button key={r.id} onClick={() => selectLocation(r)} className="w-full px-4 py-3 text-left text-sm text-slate-300 hover:bg-indigo-600/20 border-b border-slate-800 last:border-0 flex items-center gap-3"><Navigation className="w-3 h-3 text-indigo-400" /><div><div className="font-bold">{r.name}</div><div className="text-[10px] text-slate-500">{r.country}</div></div></button>))}</div>)}</div>)}
              <div className="flex items-center gap-4 text-[10px] text-slate-400 font-mono bg-[#1a1b23] p-2 rounded-lg border border-slate-800/50"><div><span className="text-slate-600">LAT:</span> <span className="text-white">{config.lat?.toFixed(4)}</span></div><div><span className="text-slate-600">LON:</span> <span className="text-white">{config.long?.toFixed(4)}</span></div>{config.locationName && <div className="ml-auto text-indigo-400 italic truncate max-w-[150px]">{config.locationName}</div>}</div>
            </div>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-700 pb-4 gap-4"><h3 className="font-semibold text-white text-sm flex items-center gap-2"><Calculator className="w-4 h-4 text-amber-400" /> String Configuration</h3><div className="flex items-center gap-4"><div className="flex items-center gap-2"><label className="text-[10px] text-slate-400 uppercase font-bold text-xs">Efficiency %</label><input type="number" value={Math.round(config.eff * 100)} onChange={e => saveConfigToCloud({ ...config, eff: Number(e.target.value) / 100 })} className="w-14 p-1 bg-[#1a1b23] border border-slate-600 rounded text-white font-mono" /></div><button onClick={addString} className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black flex items-center gap-2"><Plus className="w-4 h-4" /> Add String</button></div></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{(config.strings || []).map(s => (<div key={s.id} className="p-4 bg-[#1a1b23] rounded-2xl border border-slate-700 relative group"><div className="flex justify-between items-center mb-3"><input type="text" value={s.name} onChange={e => updateString(s.id, 'name', e.target.value)} className="bg-transparent border-b border-slate-800 text-white font-bold text-sm" /><button onClick={() => removeString(s.id)} className="p-2 text-red-500 hover:bg-red-900/10 rounded-lg"><Trash2 className="w-3 h-3" /></button></div><div className="grid grid-cols-2 gap-3"><div><label className="text-[9px] font-bold text-slate-500 uppercase">Panels</label><input type="number" value={s.count} onChange={e => updateString(s.id, 'count', Number(e.target.value))} className="w-full bg-[#252630] border border-slate-700 rounded-lg p-1 text-white" /></div><div><label className="text-[9px] font-bold text-slate-500 uppercase">Wattage</label><input type="number" value={s.wattage || 465} onChange={e => updateString(s.id, 'wattage', Number(e.target.value))} className="w-full bg-[#252630] border border-slate-700 rounded-lg p-1 text-white" /></div><div><label className="text-[9px] font-bold text-slate-500 uppercase">Azimuth</label><input type="number" value={s.azimuth} onChange={e => updateString(s.id, 'azimuth', Number(e.target.value))} className="w-full bg-[#252630] border border-slate-700 rounded-lg p-1 text-white" /></div><div><label className="text-[9px] font-bold text-slate-500 uppercase">Tilt</label><input type="number" value={s.tilt} onChange={e => updateString(s.id, 'tilt', Number(e.target.value))} className="w-full bg-[#252630] border border-slate-700 rounded-lg p-1 text-white" /></div></div></div>))}</div>
            <div className="pt-4 border-t border-slate-700/50 flex flex-col gap-4"><div className="flex justify-between items-center text-xs text-slate-400"><p>Capacity: <strong className="text-white text-sm">{totalCapacity.toFixed(2)} kWp</strong></p><button onClick={logout} className="text-red-400 md:hidden">Log Out</button></div><div className="p-2 bg-slate-900/50 rounded border border-slate-800 text-[9px] font-mono text-slate-600 flex justify-between"><p>UID: {user?.uid.slice(0,8)}...</p><p>DB: {dbStatus} | Sync: {lastSynced || "Never"}</p></div></div>
          </div>
        )}

        {showFeedback && (
          <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-4 bg-[#0f172a]/80 backdrop-blur-sm"><div className="w-full max-w-lg bg-[#252630] rounded-2xl border border-slate-700 shadow-2xl p-6 space-y-4"><div className="flex justify-between items-center"><h3 className="text-lg font-bold text-white flex items-center gap-2"><MessageSquare className="w-5 h-5 text-indigo-400" /> Community Feedback</h3><button onClick={() => setShowFeedback(false)} className="text-slate-500 text-xl">&times;</button></div><textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} placeholder="How's the accuracy?" className="w-full h-32 p-3 bg-[#1a1b23] border border-slate-600 rounded-xl text-white outline-none resize-none" /><div className="flex gap-3"><button onClick={() => setShowFeedback(false)} className="flex-1 py-3 bg-slate-800 text-slate-300 rounded-xl font-bold">Cancel</button><button onClick={submitFeedback} disabled={isSubmittingFeedback || !feedbackText.trim()} className="flex-[2] py-3 bg-indigo-600 text-white rounded-xl font-bold">{isSubmittingFeedback ? "Sending..." : "Send Feedback"}</button></div></div></div>
        )}

        {activeTab === 'today' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-[#252630] p-5 rounded-xl border border-slate-700/50 shadow-sm flex flex-col justify-between"><div><p className="text-slate-400 text-sm font-medium mb-1">Forecast Today</p><div className="flex items-end gap-2"><h2 className="text-3xl font-bold text-white">{todayForecast.yield.toFixed(1)}</h2><span className="text-slate-500 mb-1 font-medium">kWh</span></div></div><div className="mt-4 space-y-1">{(config.strings || []).map((s, idx) => (<div key={s.id} className="flex items-center gap-2 text-[10px] text-slate-500"><div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STRING_COLORS[idx % STRING_COLORS.length] }}></div><span className="truncate flex-1">{s.name}:</span><Zap className="w-2 h-2 text-indigo-500/50" /><span className="font-mono text-slate-400">{(todayForecast.strings?.[s.id] || 0).toFixed(1)}</span></div>))}</div></div>
              <div className="bg-gradient-to-br from-[#1e293b] to-[#0f172a] p-5 rounded-xl border border-indigo-500/30 shadow-sm flex flex-col justify-between"><div><label className="text-indigo-300 text-sm font-medium mb-1 flex items-center gap-2"><Zap className="w-4 h-4 text-indigo-400" /> Today's Actual</label><div className="mt-2 flex items-center gap-2"><input type="number" value={actuals[todayForecast.dayLabel] || ''} onChange={e => { saveActualToCloud(todayForecast.dayLabel, e.target.value); logAnalyticsEvent('actual_entry', { day: 'today' }); }} className="w-full bg-transparent border-b-2 border-indigo-500 p-1 text-3xl font-bold text-white outline-none" placeholder="0.0" /><span className="text-slate-500 font-medium text-xs">kWh</span></div></div><p className="mt-4 text-[10px] text-slate-500 italic leading-tight">Syncs to cloud for model tuning.</p></div>
              <div className={`p-5 rounded-xl border shadow-sm flex flex-col justify-between ${daysEntered > 0 ? (isAccurate ? 'bg-emerald-900/10 border-emerald-500/20' : 'bg-amber-900/10 border-amber-500/20') : 'bg-[#252630] border-slate-700/50'}`}><div><p className="text-slate-400 text-sm font-medium mb-1 flex items-center gap-2"><Target className="w-4 h-4" /> Calibration</p>{daysEntered > 0 ? (<div className="space-y-1 mt-2"><div className="flex items-end gap-2"><h2 className={`text-3xl font-bold ${isAccurate ? 'text-emerald-400' : 'text-amber-400'}`}>{accuracyPercentage}%</h2><span className="text-[10px] text-slate-500 mb-1 uppercase tracking-tighter text-xs font-black">Accuracy</span></div><p className="text-[10px] text-slate-500">Delta: <span className={sumActuals > sumModel ? "text-emerald-500" : "text-amber-500"}>{sumActuals > sumModel ? "+" : ""}{(sumActuals - sumModel).toFixed(2)} kWh</span></p></div>) : <p className="text-slate-500 text-xs mt-3">Enter data to tune.</p>}</div>{canApply && <button onClick={() => { saveConfigToCloud({ ...config, eff: suggestedEff }); logAnalyticsEvent('config_change', { type: 'apply_calibration' }); }} className="mt-3 w-full py-1.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 tracking-widest">APPLY CALIBRATION</button>}</div>
              <div className="hidden md:flex bg-[#252630] p-5 rounded-xl border border-slate-700/50 shadow-sm flex-col justify-between"><div><p className="text-slate-400 text-sm font-medium mb-1">Forecast Tomorrow</p><div className="flex items-end gap-2"><h2 className="text-3xl font-bold text-white">{tomorrowForecast.yield.toFixed(1)}</h2><span className="text-slate-500 mb-1 font-medium">kWh</span></div></div><div className="mt-4 flex items-center gap-2 text-[10px] text-slate-500"><Calendar className="w-3 h-3 text-blue-400" /> 24h Prediction</div></div>
            </div>
            <div className="bg-[#252630] p-4 md:p-6 rounded-2xl border border-slate-700/50 shadow-lg">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6"><h2 className="text-lg font-semibold text-white flex items-center gap-2"><Activity className="w-5 h-5 text-indigo-400" /> Hourly Profile</h2><div className="flex flex-wrap gap-2">{['clouds', 'total', 'energy', 'strings'].map(k => (<button key={k} onClick={() => toggleSeries(k)} className={`px-2 py-1 rounded text-[9px] font-bold uppercase border transition-all ${visibleSeries[k] ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-transparent border-slate-800 text-slate-600'}`}>{k}</button>))}</div></div>
              <div className="h-[250px] w-full"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={selectedDayData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" /><XAxis dataKey="timeLabel" interval={3} stroke="#64748b" fontSize={11} axisLine={false} tickLine={false} /><YAxis stroke="#64748b" fontSize={11} axisLine={false} tickLine={false} /><YAxis yAxisId="right" orientation="right" stroke="#818cf8" fontSize={10} axisLine={false} tickLine={false} unit="kWh" /><Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} content={({ active, payload, label }) => { if (active && payload && payload.length) return (<div className="bg-[#1e293b] border border-slate-700 p-3 rounded-lg shadow-xl text-[10px] space-y-1"><p className="font-bold text-slate-400 mb-1">{label}</p>{payload.map((e, idx) => (<div key={idx} className="flex justify-between gap-4"><span style={{ color: e.color }}>{e.name}:</span><span className="text-white font-mono">{e.value} {e.dataKey === 'cumulativeYield' ? 'kWh' : (e.dataKey === 'cloudCover' ? '%' : 'kW')}</span></div>))}</div>); return null; }} />{visibleSeries.clouds && <Area yAxisId="right" type="monotone" dataKey="cloudCover" name="Cloud %" stroke="none" fill="#475569" fillOpacity={0.1} />}{visibleSeries.total && <Area type="monotone" dataKey="total" name="Total Power" stroke="#fde047" fill="#fde047" fillOpacity={0.1} strokeWidth={2} />}{visibleSeries.strings && (config.strings || []).map((s, idx) => <Line key={s.id} type="monotone" dataKey={`stringPowers.${s.id}`} name={s.name} stroke={STRING_COLORS[idx % STRING_COLORS.length]} strokeWidth={1} dot={false} strokeDasharray="5 5" />)}{visibleSeries.energy && <Line yAxisId="right" type="monotone" dataKey="cumulativeYield" name="Energy" stroke="#818cf8" strokeWidth={3} dot={false} />}{currentHourTick && <ReferenceLine x={currentHourTick} stroke="#818cf8" strokeDasharray="4 4" />}</ComposedChart></ResponsiveContainer></div>
            </div>
          </div>
        )}

        {activeTab === 'forecast' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 pb-8">
            <div className="bg-[#252630] rounded-2xl border border-slate-700/50 overflow-hidden shadow-lg"><button onClick={() => setShowForecastChart(!showForecastChart)} className="w-full p-4 flex justify-between items-center hover:bg-[#2d2e3a] transition-colors"><div className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-indigo-400" /><h2 className="text-sm font-bold text-white uppercase tracking-wider font-black uppercase">Visual Outlook</h2></div>{showForecastChart ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}</button>{showForecastChart && (<div className="p-6 pt-0 animate-in zoom-in-95 duration-200"><div className="h-[200px] w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}><defs><linearGradient id="colorYellow" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#fde047" stopOpacity={0.4} /><stop offset="95%" stopColor="#fde047" stopOpacity={0.0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" /><XAxis dataKey="fullLabel" tickFormatter={(val) => val.split(' ')[0]} interval={23} stroke="#64748b" fontSize={11} axisLine={false} tickLine={false} /><YAxis stroke="#64748b" fontSize={11} domain={[0, Math.ceil(maxKw)]} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} /><Area type="monotone" dataKey="total" name="Total kW" stroke="#fde047" fill="url(#colorYellow)" strokeWidth={2} /></AreaChart></ResponsiveContainer></div></div>)}</div>
            <div className="grid grid-cols-1 gap-3">{dailyTotals.filter(d => d.dayOffset >= 0).map((day) => { const maxWeekYield = Math.max(...dailyTotals.map(d => d.yield)); const relScale = (day.yield / maxWeekYield) * 100; const isExpanded = expandedForecastDay === day.dayLabel; return (<div key={day.dayLabel} className={`bg-[#252630] rounded-2xl border transition-all duration-300 ${isExpanded ? 'border-indigo-500/50 ring-1 ring-indigo-500/20' : 'border-slate-800'}`}><button onClick={() => { setExpandedForecastDay(isExpanded ? null : day.dayLabel); logAnalyticsEvent('expand_forecast_day', { day: day.dayLabel }); }} className="w-full p-4 flex items-center gap-4 text-left"><div className="text-center min-w-[56px] border-r border-slate-800 pr-4"><div className="text-[10px] text-slate-500 font-black uppercase tracking-widest">{day.date.toLocaleDateString([], { weekday: 'short' })}</div><div className="text-xl font-black text-white">{day.date.toLocaleDateString([], { day: 'numeric' })}</div></div><div className="flex-1 min-w-0"><div className="flex justify-between items-end mb-1.5"><span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Predicted</span><span className="text-sm font-black text-white">{day.yield.toFixed(1)} <span className="text-[10px] text-slate-500 font-normal uppercase font-black tracking-widest">kWh</span></span></div><div className="h-2 w-full bg-slate-800/50 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-1000 ${day.yield > maxWeekYield*0.8 ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]' : 'bg-indigo-500'}`} style={{ width: `${relScale}%` }}></div></div></div><div className="pl-2 flex flex-col items-center">{day.yield > maxWeekYield*0.8 ? <Sun className="w-6 h-6 text-amber-400" /> : day.yield < maxWeekYield*0.4 ? <CloudRain className="w-6 h-6 text-slate-500" /> : <Cloud className="w-6 h-6 text-indigo-400/60" />}{isExpanded ? <ChevronUp className="w-3 h-3 text-slate-600 mt-1" /> : <ChevronDown className="w-3 h-3 text-slate-600 mt-1" />}</div></button>{isExpanded && (<div className="p-4 pt-0 animate-in slide-in-from-top-2 duration-300"><div className="h-[180px] w-full mt-2 bg-[#1a1b23]/50 rounded-xl p-2 border border-slate-800/50"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.filter(d => d.dayLabel === day.dayLabel)} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" /><XAxis dataKey="timeLabel" interval={3} stroke="#475569" fontSize={9} axisLine={false} tickLine={false} /><YAxis stroke="#475569" fontSize={9} axisLine={false} tickLine={false} /><Area type="monotone" dataKey="total" name="kW" stroke="#fde047" fill="#fde047" fillOpacity={0.1} strokeWidth={2} /><Line type="monotone" dataKey="cumulativeYield" yAxisId="right" stroke="#818cf8" strokeWidth={2} dot={false} /><YAxis yAxisId="right" orientation="right" hide={true} /><Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', fontSize: '10px' }} itemStyle={{ padding: '2px 0' }} /></ComposedChart></ResponsiveContainer></div></div>)}</div>); })}</div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            {config.effHistory?.length > 1 && (<div className="bg-[#252630] p-6 rounded-2xl border border-slate-700/50 shadow-lg"><div className="flex justify-between items-center mb-6"><h2 className="text-lg font-semibold text-white flex items-center gap-2"><TrendingUp className="w-5 h-5 text-emerald-400" />Efficiency Trend</h2><div className="text-xs text-slate-500 font-mono">Last 50 Updates</div></div><div className="h-[150px] w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={[...config.effHistory].reverse()}><defs><linearGradient id="colorEff" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" /><XAxis dataKey="label" stroke="#475569" fontSize={10} /><YAxis domain={['auto', 'auto']} hide /><Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }} formatter={v => [(v * 100).toFixed(1) + "%", "Eff"]} /><Area type="monotone" dataKey="val" stroke="#10b981" fill="url(#colorEff)" strokeWidth={2} /></AreaChart></ResponsiveContainer></div></div>)}
            <div className="bg-[#252630] rounded-2xl border border-slate-700/50 overflow-hidden shadow-lg"><div className="p-4 border-b border-slate-700/50 bg-[#1e293b]/50"><h2 className="text-sm font-bold text-white uppercase tracking-widest">History</h2></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-[#1e293b]/50 border-b border-slate-700"><tr className="text-slate-400 uppercase text-[10px] font-bold"><th className="p-4">Date</th><th className="p-4">Model</th><th className="p-4 text-indigo-400">Actual</th></tr></thead><tbody className="text-slate-300 divide-y divide-slate-700/50">{dailyTotals.map((day, i) => (<tr key={i} className="hover:bg-[#2d2e3a] transition-colors"><td className="p-4 font-medium text-xs">{day.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</td><td className="p-4 font-bold text-white text-xs">{day.yield.toFixed(2)} kWh</td><td className="p-4"><div className="flex items-center gap-2"><input type="number" value={actuals[day.dayLabel] || ''} onChange={e => saveActualToCloud(day.dayLabel, e.target.value)} className="w-16 h-8 bg-[#1a1b23] border border-slate-600 rounded px-2 text-white text-xs" /><Zap className="w-3 h-3 text-slate-600" /></div></td></tr>))}</tbody></table></div></div>
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
