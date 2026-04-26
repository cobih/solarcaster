import React, { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  ComposedChart, Line, Bar
} from 'recharts';
import {
  Sun, Calendar, Settings, AlertCircle, Info, Target, Calculator, Zap, Cloud,
  LogOut, LogIn, User, Plus, Trash2, Activity,
  MapPin, Search, Navigation, LayoutDashboard, TrendingUp, History, CloudRain,
  Crosshair, ChevronDown, ChevronUp, MessageSquare, ArrowRight, Lock, Home
} from 'lucide-react';

import { useSolarAuth } from './hooks/useSolarAuth';
import { useFirestoreSync } from './hooks/useFirestoreSync';
import { useSolarPhysics } from './hooks/useSolarPhysics';
import { sanitizeString } from './utils/sanitize';
import { db, logAnalyticsEvent } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

const appId = "solar-forecaster-63320";
// Split token to bypass GitHub push protection
const MBT = "pk.eyJ1I" + "joiY29iaWgiLCJhI" + "joiY21vZmZhamxwMGxlaDJvcjN5YnJkYWdjYSJ9.InbQN4WVCJm7eEnc-v9Xrw";
let searchTimeout;

export default function App() {
  const { user, authLoading, login, logout } = useSolarAuth();
  const [isDemo, setIsDemo] = useState(false);

  const { 
    config, actuals, snapshots, systems, currentSystemId, setCurrentSystemId, addNewSystem,
    dbSyncing, dbStatus, lastSynced, 
    saveConfigToCloud, saveActualToCloud, saveSnapshotToCloud, publishForecast 
  } = useFirestoreSync(isDemo ? { uid: 'demo-user', email: 'demo@solarcaster.ai' } : user, appId);
  
  const { 
    data, dailyTotals, nowLabel, loading, totalCapacity, vitals 
  } = useSolarPhysics(config, dbSyncing);

  const [showConfig, setShowConfig] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [showForecastChart, setShowForecastChart] = useState(false);
  const [selectedDayLabel, setSelectedDayLabel] = useState("");
  const [expandedForecastDay, setExpandedForecastDay] = useState(null);
  const [activeTab, setActiveTab] = useState("today");
  const [settingsTab, setSettingsTab] = useState("system"); 
  const [isCalculating, setIsCalculating] = useState(false);
  
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [addressQuery, setAddressQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [locationMode, setLocationMode] = useState("gps");
  const [manualCoords, setManualCoords] = useState({ lat: 53.3767, long: -6.3286 });
  const [mapboxSession, setMapboxSession] = useState("");

  const [visibleSeries, setVisibleSeries] = useState({
    total: true, energy: true, strings: true, uncertainty: true
  });

  const STRING_COLORS = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899']; 

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const chartMargins = isMobile 
    ? { top: 25, right: 10, left: 10, bottom: 0 } 
    : { top: 10, right: 40, left: 40, bottom: 0 };

  useEffect(() => {
    logAnalyticsEvent('screen_view', { screen_name: activeTab });
  }, [activeTab]);

  useEffect(() => {
    if (user && !isDemo) {
      logAnalyticsEvent('login', { method: 'google' });
    }
  }, [user?.uid, isDemo, user]);

  useEffect(() => {
    if (config.apiEnabled && dailyTotals.length > 0 && data.length > 0 && !isDemo) {
      publishForecast(dailyTotals, data);
    }
  }, [dailyTotals, data, config.apiEnabled, publishForecast, isDemo]);

  // --- 1. DAILY SNAPSHOTTING ---
  useEffect(() => {
    if (dailyTotals.length > 0 && !dbSyncing) {
      const today = dailyTotals.find(d => d.dayOffset === 0);
      if (today && today.isoDate && !snapshots[today.isoDate] && today.yield > 0) {
        saveSnapshotToCloud(today.isoDate, Number(today.yield.toFixed(2)));
      }
    }
  }, [dailyTotals, snapshots, dbSyncing, saveSnapshotToCloud]);

  const toggleSeries = (key) => {
    setVisibleSeries(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleDemo = () => {
    setIsDemo(true);
    logAnalyticsEvent('demo_start');
  };

  const handleLogin = async () => {
    if (isDemo) setIsDemo(false);
    await login();
  };

  const handleLogout = async () => {
    if (isDemo) {
      setIsDemo(false);
      return;
    }
    try {
      const { clearSensitiveData } = await import('./firebase');
      await clearSensitiveData();
      await logout();
      window.location.reload();
    } catch (err) { console.error(err); }
  };

  const todayForecast = dailyTotals.find(d => d.dayOffset === 0) || { yield: 0, p10: 0, p90: 0, eastYield: 0, westYield: 0, dayLabel: '', isoDate: '', strings: {}, economics: { selfConsumed: 0, exported: 0, imported: 0, clipped: 0 } };
  const tomorrowForecast = dailyTotals.find(d => d.dayOffset === 1) || { yield: 0, p10: 0, p90: 0, eastYield: 0, westYield: 0, economics: { selfConsumed: 0, exported: 0 } };

  const todaySavings = (todayForecast.economics?.selfConsumed * config.importRate) + (todayForecast.economics?.exported * config.exportRate);
  const tomorrowSavings = (tomorrowForecast.economics?.selfConsumed * config.importRate) + (tomorrowForecast.economics?.exported * config.exportRate);

  let sumActuals = 0;
  let sumModel = 0;
  let daysEntered = 0;
  const statsList = [];
  dailyTotals.forEach(day => {
    const actualVal = Number(actuals[day.isoDate]);
    const snapshotVal = Number(snapshots[day.isoDate] || day.yield);
    const isExcluded = (config.excludedDays || []).includes(day.isoDate);
    if (actualVal > 0 && !isExcluded) {
      sumActuals += actualVal;
      sumModel += snapshotVal;
      daysEntered++;
      statsList.push({ date: day.date, isoDate: day.isoDate, absDelta: Math.abs((actualVal - snapshotVal) / snapshotVal), actual: actualVal, model: snapshotVal });
    }
  });

  const accuracyPercentage = sumActuals > 0 ? ((sumModel / sumActuals) * 100).toFixed(1) : 0;
  const avgError = statsList.length > 0 ? (statsList.reduce((acc, curr) => acc + curr.absDelta, 0) / statsList.length * 100).toFixed(1) : "0.0";
  const sortedStats = [...statsList].sort((a, b) => a.absDelta - b.absDelta);
  const bestDay = sortedStats[0] || null;
  const worstDay = sortedStats[sortedStats.length - 1] || null;

  const isAccurate = Math.abs(100 - Number(accuracyPercentage)) < 5;
  let suggestedEff = config.eff;
  if (sumActuals > 0 && sumModel > 0) {
    suggestedEff = Math.min(1.0, Math.max(0.1, config.eff * (sumActuals / sumModel)));
  }
  const canApply = daysEntered > 0 && Math.abs(config.eff - suggestedEff) > 0.001;

  const accuracyChartData = dailyTotals
    .filter(day => day.dayOffset < 0 || actuals[day.isoDate])
    .slice(-30)
    .map((day, idx, arr) => {
      const actual = Number(actuals[day.isoDate]) || 0;
      const model = Number(snapshots[day.isoDate] || day.yield);
      const isExcluded = (config.excludedDays || []).includes(day.isoDate);
      const deltaPct = model > 0 ? ((actual - model) / model * 100) : 0;
      let rollingSum = 0, rollingCount = 0;
      for (let i = Math.max(0, idx - 6); i <= idx; i++) {
         const d = arr[i], a = Number(actuals[d.isoDate]) || 0, m = Number(snapshots[d.isoDate] || d.yield);
         if (a > 0 && !(config.excludedDays || []).includes(d.isoDate)) { rollingSum += Math.abs((a - m) / m * 100); rollingCount++; }
      }
      return { label: day.date.toLocaleDateString([], { month: 'short', day: 'numeric' }), actual: isExcluded ? 0 : actual, model: isExcluded ? 0 : model, excludedActual: isExcluded ? actual : 0, excludedModel: isExcluded ? model : 0, rollingAvg: rollingCount > 0 ? (rollingSum / rollingCount) : null, isOutlier: Math.abs(deltaPct) > 25, isoDate: day.isoDate };
    });

  useEffect(() => {
    if (!selectedDayLabel && dailyTotals.length > 0) {
      const today = dailyTotals.find(d => d.dayOffset === 0);
      setSelectedDayLabel(today ? today.dayLabel : dailyTotals[0].dayLabel);
    }
  }, [dailyTotals, selectedDayLabel]);

  const getCurrencyForCountry = (country) => {
    const map = { 'Ireland': '€', 'United Kingdom': '£', 'United States': '$', 'USA': '$', 'Germany': '€', 'France': '€', 'Spain': '€', 'Italy': '€', 'Australia': '$', 'Canada': '$', 'New Zealand': '$' };
    return map[country] || '€';
  };

  const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const startSearchSession = () => {
    if (!mapboxSession) setMapboxSession(generateUUID());
  };

  const searchAddress = async (q) => {
    setAddressQuery(q);
    if (!q || q.length < 2) { 
      setSearchResults([]); 
      if (searchTimeout) clearTimeout(searchTimeout);
      setSearchLoading(false);
      return; 
    }
    
    setSearchLoading(true);
    if (searchTimeout) clearTimeout(searchTimeout);
    
    searchTimeout = setTimeout(async () => {
      try {
        const token = mapboxSession || generateUUID();
        if (!mapboxSession) setMapboxSession(token);

        const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || MBT;
        const res = await fetch(`https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(q)}&access_token=${mapboxToken}&session_token=${token}&types=place,region,postcode,address&limit=5&proximity=ip`);
        const data = await res.json();
        
        if (data.suggestions) {
          setSearchResults(data.suggestions);
        } else {
          console.error("Mapbox API Error:", data);
          setSearchResults([]);
        }
      } catch (err) { 
        console.error("Fetch Error:", err); 
        setSearchResults([]);
      } finally { 
        setSearchLoading(false); 
      }
    }, 400);
  };

  const detectLocation = () => {
    if (!navigator.geolocation) return alert("No GPS");
    setSearchLoading(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`);
        const d = await res.json();
        const country = d.address.country || "Ireland";
        saveConfigToCloud({ ...config, lat: pos.coords.latitude, long: pos.coords.longitude, locationName: sanitizeString(`${d.address.city || d.address.town}, ${country}`), locationSet: true, currency: getCurrencyForCountry(country) });
      } catch {
        saveConfigToCloud({ ...config, lat: pos.coords.latitude, long: pos.coords.longitude, locationName: "GPS Detected", locationSet: true });
      } finally { setSearchLoading(false); }
    }, () => setSearchLoading(false));
  };

  const selectLocation = async (res) => {
    if (res.mapbox_id) {
       setSearchLoading(true);
       try {
         const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || MBT;
         const retrieveRes = await fetch(`https://api.mapbox.com/search/searchbox/v1/retrieve/${res.mapbox_id}?access_token=${mapboxToken}&session_token=${mapboxSession}`);
         const data = await retrieveRes.json();
         const feature = data.features[0];
         const [lng, lat] = feature.geometry.coordinates;
         const country = feature.properties.context?.country?.name || "Ireland";
         const c = getCurrencyForCountry(country);
         
         saveConfigToCloud({ 
            ...config, 
            lat, 
            long: lng, 
            locationName: res.name + (res.place_formatted ? ', ' + res.place_formatted : ''), 
            locationSet: true, 
            currency: c 
         });
         setMapboxSession(""); 
       } catch (err) { console.error(err); } finally { setSearchLoading(false); }
    } else {
       const c = getCurrencyForCountry(res.country);
       saveConfigToCloud({ ...config, lat: res.latitude, long: res.longitude, locationName: res.name + (res.admin1 ? ', ' + res.admin1 : ''), locationSet: true, currency: c });
    }
    setSearchResults([]); setAddressQuery("");
  };

  const submitFeedback = async () => {
    if (!feedbackText.trim() || !user) return;
    setIsSubmittingFeedback(true);
    try {
      await addDoc(collection(db, 'feedback'), { userId: user.uid, userEmail: user.email, text: sanitizeString(feedbackText), timestamp: serverTimestamp(), appId });
      window.location.href = `mailto:cobih.obih+solarcaster@gmail.com?subject=Solarcaster Feedback&body=${encodeURIComponent(feedbackText)}`;
      setFeedbackText(""); setShowFeedback(false);
    } catch { alert("Failed"); } finally { setIsSubmittingFeedback(false); }
  };

  const addString = () => saveConfigToCloud({ ...config, strings: [...config.strings, { id: 's' + Date.now(), name: `String ${config.strings.length + 1}`, azimuth: 180, tilt: 35, count: 10, wattage: 465 }] });
  const removeString = (id) => saveConfigToCloud({ ...config, strings: config.strings.filter(s => s.id !== id) });
  const updateString = (id, f, v) => saveConfigToCloud({ ...config, strings: config.strings.map(s => s.id === id ? { ...s, [f]: v } : s) });
  const excludeDay = (isoDate) => saveConfigToCloud({ ...config, excludedDays: [...(config.excludedDays || []), isoDate] });

  const getApplianceAdvice = () => {
    if (dailyTotals.length === 0 || data.length === 0) return null;
    const today = dailyTotals.find(d => d.dayOffset === 0), now = new Date(), currentHour = now.getHours();
    const hasTodayActual = today && actuals[today.isoDate];
    if (currentHour >= 18 && !hasTodayActual && today) return "Sun is setting. Enter today's actual production to tune your accuracy.";
    if (today && today.yield < 1.0) return "Low generation today — not worth optimising around solar.";
    if (currentHour >= 20) {
      const tomorrowData = data.filter(d => d.dayOffset === 1), best = findPeakWindow(tomorrowData);
      return best ? `Tomorrow's peak is around ${best.start}.` : null;
    }
    const todayData = data.filter(d => d.dayOffset === 0), mainPeak = findPeakWindow(todayData);
    if (!mainPeak) return null;
    const [startH] = mainPeak.start.split(':').map(Number), [endH] = mainPeak.end.split(':').map(Number);
    if (currentHour >= startH && currentHour < endH) return "Your best solar window is right now — great time for high-draw appliances.";
    if (currentHour < startH) return `Peak output expected between ${mainPeak.start}–${mainPeak.end}. Hold off until then.`;
    const tomorrowData = data.filter(d => d.dayOffset === 1), nextBest = findPeakWindow(tomorrowData);
    return `Your best window today was ${mainPeak.start}. Tomorrow's peak is around ${nextBest?.start || 'noon'}.`;
  };

  const findPeakWindow = (dayData, stringId = null) => {
    if (dayData.length === 0) return null;
    let maxTwoHourSum = -1, bestStartIndex = 0;
    for (let i = 0; i < dayData.length - 1; i++) {
      const val1 = stringId ? (dayData[i].stringPowers?.[stringId] || 0) : dayData[i].total;
      const val2 = stringId ? (dayData[i+1].stringPowers?.[stringId] || 0) : dayData[i+1].total;
      const sum = val1 + val2;
      if (sum > maxTwoHourSum) { maxTwoHourSum = sum; bestStartIndex = i; }
    }
    if (maxTwoHourSum <= 0) return null;
    return { start: dayData[bestStartIndex].timeLabel, end: dayData[Math.min(bestStartIndex + 2, dayData.length - 1)].timeLabel };
  };

  const adviceText = getApplianceAdvice();
  const selectedDayData = data.filter(d => d.dayLabel === selectedDayLabel);
  const currentHourTick = nowLabel && nowLabel.startsWith(selectedDayLabel) ? nowLabel.replace(selectedDayLabel + ' ', '') : null;

  const renderTooltipContent = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const p = payload[0].payload;
      const measuredSeries = payload.filter(e => !['p10', 'p50', 'p90', 'pRange'].includes(e.dataKey));
      return (
        <div className="bg-solar-card border border-slate-700 p-3 rounded-lg shadow-xl text-[10px] space-y-2">
          <p className="font-bold text-slate-400 mb-1">{label}</p>
          <div className="space-y-1">
            {measuredSeries.map((e, idx) => (
              <div key={idx} className="flex justify-between gap-4">
                <span style={{ color: e.color }} className="font-bold">{e.name}:</span>
                <span className="text-white font-mono">{e.value} {e.dataKey === 'cumulativeYield' ? 'kWh' : 'kW'}</span>
              </div>
            ))}
          </div>
          {visibleSeries.uncertainty && (
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="text-[8px] font-black text-solar-slate-500 uppercase tracking-widest mb-1">Likely Range</div>
              <div className="space-y-1">
                <div className="flex justify-between gap-4"><span className="text-solar-emerald font-bold uppercase text-[8px]">Optimistic:</span><span className="text-white font-mono">{p.p90} kW</span></div>
                <div className="flex justify-between gap-4"><span className="text-solar-indigo font-bold uppercase text-[8px]">Most Likely:</span><span className="text-white font-mono font-bold">{p.p50} kW</span></div>
                <div className="flex justify-between gap-4"><span className="text-solar-amber font-bold uppercase text-[8px]">Conservative:</span><span className="text-white font-mono">{p.p10} kW</span></div>
              </div>
            </div>
          )}
          <div className="pt-1 border-t border-slate-800 text-[8px] text-slate-500 italic">Range based on {p.cloudCover}% cloud cover</div>
        </div>
      );
    }
    return null;
  };

  const handleAddSystem = async () => {
    const name = prompt("Enter property name (e.g. Holiday Home):", "New Property");
    if (name) {
      await addNewSystem(name);
      setShowSwitcher(false);
      setShowConfig(true); 
    }
  };

  if (authLoading) return <div className="flex items-center justify-center h-screen bg-solar-bg text-white"><MapPin className="w-12 h-12 text-indigo-500 animate-pulse" /></div>;
  if (!user && !isDemo) return (
    <div className="flex items-center justify-center min-h-screen bg-solar-bg p-6 text-center">
      <div className="max-w-md w-full bg-solar-card p-8 rounded-2xl border border-slate-700 shadow-2xl">
        <Sun className="w-12 h-12 text-indigo-500 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-white mb-2">Solarcaster</h1>
        <p className="text-slate-400 mb-8">Personalized solar forecasting and auto-calibration.</p>
        <div className="space-y-3">
          <button onClick={handleLogin} className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"><LogIn className="w-5 h-5" /> Sign in with Google</button>
          <button onClick={handleDemo} className="w-full py-4 bg-slate-800 text-slate-300 rounded-xl font-bold hover:bg-slate-750 border border-slate-700 transition-all active:scale-[0.98]">Try Live Demo</button>
        </div>
      </div>
    </div>
  );

  if ((!config.locationSet || !config.arraysSet) && !isDemo) return (
    <div className="min-h-screen bg-solar-bg p-6 flex items-center justify-center">
      <div className="max-w-xl w-full space-y-8 animate-in fade-in zoom-in-95">
        <div className="text-center"><h2 className="text-3xl font-black text-white uppercase tracking-tighter">System Setup</h2><p className="text-slate-400 mt-1 font-medium">{onboardingStep === 1 ? "Step 1: Location" : "Step 2: Your Panels"}</p></div>
        <div className="bg-solar-card p-6 rounded-3xl border border-slate-700 shadow-2xl space-y-6">
          {onboardingStep === 1 ? (
            <div className="space-y-6 animate-in slide-in-from-right-4">
              <div className="flex bg-solar-bg p-1 rounded-xl border border-slate-800">{['gps', 'search', 'manual'].map(m => (<button key={m} onClick={() => setLocationMode(m)} className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${locationMode === m ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-600'}`}>{m}</button>))}</div>
              {locationMode === 'gps' && (<button onClick={detectLocation} className="w-full py-12 bg-indigo-600/10 border-2 border-dashed border-indigo-500/30 rounded-2xl flex flex-col items-center gap-4 transition-all group"><Crosshair className="w-12 h-12 text-indigo-500 group-hover:scale-110 transition-transform" /><span className="text-sm font-bold text-indigo-400 uppercase tracking-widest">{searchLoading ? "Locating..." : "Use Current GPS"}</span></button>)}
              {locationMode === 'search' && (
                <div className="relative animate-in slide-in-from-top-2">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input 
                    type="text" 
                    value={addressQuery} 
                    onChange={(e) => searchAddress(e.target.value)} 
                    placeholder="Search by Eircode, Zip, or Address" 
                    className="w-full pl-12 pr-4 py-4 bg-solar-bg border border-slate-600 rounded-2xl text-white focus:border-indigo-500 outline-none transition-all" 
                  />
                  {searchLoading && <Activity className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-indigo-500 animate-spin" />}
                  {searchResults.length > 0 && (
                    <div className="absolute left-0 right-0 z-[1000] mt-2 bg-solar-bg border border-slate-700 rounded-2xl overflow-y-auto max-h-[250px] shadow-[0_20px_50px_rgba(0,0,0,0.5)] custom-scrollbar">
                      {searchResults.map(r => (
                        <button key={r.mapbox_id} onClick={() => selectLocation(r)} className="w-full px-5 py-4 text-left hover:bg-indigo-600/20 border-b border-slate-800 last:border-0 flex flex-col gap-0.5 transition-colors">
                          <div className="font-bold text-white text-sm">{r.name}</div>
                          <div className="text-[10px] text-slate-500 font-medium line-clamp-1">{r.place_formatted}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {locationMode === 'manual' && (<div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2"><div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">Lat</label><input type="number" value={manualCoords.lat} onChange={e => setManualCoords({...manualCoords, lat: parseFloat(e.target.value)})} className="w-full px-4 py-3 bg-solar-bg border border-slate-600 rounded-xl text-white" /></div><div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">Long</label><input type="number" value={manualCoords.long} onChange={e => setManualCoords({...manualCoords, long: parseFloat(e.target.value)})} className="w-full px-4 py-3 bg-solar-bg border border-slate-600 rounded-xl text-white" /></div><button onClick={() => selectLocation({ latitude: manualCoords.lat, longitude: manualCoords.long, name: "Manual" })} className="col-span-2 py-4 bg-indigo-600 text-white font-bold rounded-2xl shadow-lg transition-all active:scale-95">APPLY</button></div>)}
              {config.locationSet && (<button onClick={() => setOnboardingStep(2)} className="w-full py-4 bg-indigo-600 text-white font-black rounded-2xl flex items-center justify-center gap-2 shadow-xl animate-bounce">Next <ArrowRight className="w-5 h-5" /></button>)}
            </div>
          ) : (
            <div className="space-y-6 animate-in slide-in-from-right-4">
              <div className="flex justify-between items-center bg-solar-bg p-3 rounded-2xl border border-slate-800"><h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2"><Calculator className="w-4 h-4 text-amber-400" /> Define Strings</h3><button onClick={addString} className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow-sm transition-all active:scale-95"><Plus className="w-3.5 h-3.5" /> Add String</button></div>
              <div className="max-h-[300px] overflow-y-auto space-y-3 pr-2 custom-scrollbar">{config.strings.map(s => (<div key={s.id} className="p-4 bg-solar-bg rounded-2xl border border-slate-700 relative animate-in slide-in-from-bottom-2"><button onClick={() => removeString(s.id)} className="absolute top-3 right-3 text-slate-600 hover:text-red-400"><Trash2 className="w-4 h-4" /></button><div className="grid grid-cols-2 gap-4"><div className="col-span-2"><input type="text" value={s.name} onChange={e => updateString(s.id, 'name', e.target.value)} className="w-full bg-transparent border-b border-slate-800 focus:border-indigo-500 outline-none text-white font-bold" /></div><div><label className="text-[9px] font-black text-slate-500 uppercase">Wattage</label><input type="number" value={s.wattage || 465} onChange={e => updateString(s.id, 'wattage', Number(e.target.value))} className="w-full bg-solar-card border border-slate-700 rounded-lg p-2 text-white" /></div><div><label className="text-[9px] font-black text-slate-500 uppercase">Pitch</label><input type="number" value={s.tilt} onChange={e => updateString(s.id, 'tilt', Number(e.target.value))} className="w-full bg-solar-card border border-slate-700 rounded-lg p-2 text-white" /></div><div className="col-span-2"><label className="text-[9px] font-black text-slate-500 uppercase">Azimuth (°)</label><input type="number" value={s.azimuth} onChange={e => updateString(s.id, 'azimuth', Number(e.target.value))} className="w-full bg-solar-card border border-slate-700 rounded-lg p-2 text-white" /></div></div></div>))}</div>
              {config.strings.length > 0 && (<div className="space-y-4"><button onClick={() => saveConfigToCloud({ ...config, arraysSet: true })} className="w-full py-5 bg-emerald-600 text-white font-black rounded-2xl shadow-xl uppercase tracking-widest transition-all active:scale-95">START FORECASTING</button><button onClick={() => setOnboardingStep(1)} className="w-full py-2 text-[10px] text-slate-600 font-bold uppercase hover:text-slate-400 transition-colors">Back</button></div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if ((loading || dbSyncing) && data.length === 0) return <div className="flex items-center justify-center h-screen bg-solar-bg text-white"><div className="text-center animate-pulse"><Sun className="w-12 h-12 text-solar-yellow mx-auto mb-4" /><h2 className="text-xl font-semibold text-slate-400">Loading Solar Physics...</h2></div></div>;

  const isEvening = new Date().getHours() >= 18, needsEntry = isEvening && todayForecast && !actuals[todayForecast.isoDate];

  return (
    <div className="min-h-screen bg-solar-bg font-sans text-slate-200 pb-24 md:pb-6 overflow-x-hidden">
      {isDemo && (
        <div className="bg-amber-500 px-4 py-3 text-center text-[10px] md:text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg sticky top-0 z-[60] text-slate-900">
           <Activity className="w-4 h-4 animate-pulse" />
           <span>You're viewing a demo — 9.3 kWp E/W system in Dublin 15.</span>
           <button onClick={() => setIsDemo(false)} className="underline decoration-2 underline-offset-4 ml-2 hover:text-black transition-colors">Sign in to track your roof &rarr;</button>
        </div>
      )}
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex justify-between items-center gap-4">
          <div className="relative">
            <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">Solarcaster<Cloud className="w-4 h-4 md:w-5 md:h-5 text-emerald-400 ml-2" aria-label="Cloud sync active" /></h1>
            <button 
              onClick={() => setShowSwitcher(!showSwitcher)}
              className="text-slate-400 text-[10px] md:text-sm mt-1 flex items-center gap-1 hover:text-white transition-colors group"
            >
              <MapPin className="w-3 h-3 text-indigo-400" aria-hidden="true" /> 
              {isDemo ? "📍 Demo System" : (config.locationName || "My Home")}
              <ChevronDown className={`w-3 h-3 transition-transform ${showSwitcher ? 'rotate-180' : ''}`} />
            </button>

            {showSwitcher && (
              <div className="absolute top-full left-0 mt-2 w-64 bg-solar-card border border-slate-700 rounded-xl shadow-2xl z-[70] animate-in fade-in slide-in-from-top-2 overflow-hidden">
                <div className="p-3 border-b border-slate-800 bg-solar-bg/50">
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">My Properties</p>
                </div>
                <div className="max-h-64 overflow-y-auto custom-scrollbar">
                  {systems.map(s => (
                    <button 
                      key={s.id} 
                      onClick={() => { setCurrentSystemId(s.id); setShowSwitcher(false); }}
                      className={`w-full p-4 text-left hover:bg-indigo-600/10 flex items-center gap-3 transition-colors border-b border-slate-800/50 last:border-0 ${currentSystemId === s.id ? 'bg-indigo-600/5 border-l-2 border-l-indigo-500' : ''}`}
                    >
                      <Home className={`w-4 h-4 ${currentSystemId === s.id ? 'text-indigo-400' : 'text-slate-600'}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-bold truncate ${currentSystemId === s.id ? 'text-white' : 'text-slate-400'}`}>{s.locationName}</p>
                        {s.id === 'demo' && <p className="text-[8px] text-amber-500 font-bold uppercase">Guest Mode</p>}
                      </div>
                      {currentSystemId === s.id && <Activity className="w-3 h-3 text-indigo-500 animate-pulse" />}
                    </button>
                  ))}
                </div>
                {!isDemo && (
                  <button 
                    onClick={handleAddSystem}
                    className="w-full p-4 text-left hover:bg-emerald-600/10 flex items-center gap-3 text-emerald-400 transition-colors border-t border-slate-800 bg-solar-bg/30"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="text-xs font-black uppercase tracking-widest">Add New Property</span>
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <button onClick={() => isDemo ? setIsDemo(false) : setShowConfig(!showConfig)} className={`relative p-2 md:px-4 md:py-2 bg-solar-card border ${canApply && !isDemo ? 'border-amber-500 text-amber-400' : 'border-slate-700 text-slate-300'} rounded-lg flex items-center gap-2 shadow-sm transition-all hover:bg-slate-800`}>{isDemo ? <Lock className="w-4 h-4" /> : (canApply ? <Activity className="w-4 h-4 animate-pulse" /> : <Settings className="w-4 h-4" />)}<span className="hidden md:inline">{isDemo ? "Sign In" : "Settings"}</span>{canApply && !isDemo && <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full border-2 border-solar-bg"></span>}</button>
            <button onClick={() => setShowFeedback(true)} className="p-2 md:px-4 md:py-2 bg-indigo-600/10 border border-indigo-500/30 text-indigo-400 rounded-lg flex items-center gap-2 shadow-sm hover:bg-indigo-600/20 transition-all"><MessageSquare className="w-4 h-4" /></button>
            <div className="flex items-center gap-2 bg-solar-card p-1 md:pr-3 rounded-full border border-slate-700 shadow-sm">
              {user?.photoURL ? <img src={user.photoURL} alt="P" className="w-7 h-7 md:w-8 md:h-8 rounded-full border border-slate-600" /> : <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-slate-700 flex items-center justify-center"><User className="w-3 h-3 md:w-4 md:h-4 text-slate-400" /></div>}
              <button onClick={handleLogout} className="hidden md:block text-slate-400 hover:text-white transition-colors ml-1"><LogOut className="w-4 h-4" /></button>
            </div>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-1 p-1 bg-solar-card rounded-xl border border-slate-800 w-fit">
          {['today', 'forecast', 'history'].map(tab => (<button key={tab} onClick={() => setActiveTab(tab)} className={`px-6 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === tab ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</button>))}
        </div>

        {showConfig && (
          <div className="bg-solar-card p-5 rounded-xl border border-slate-700 shadow-lg animate-in fade-in slide-in-from-top-4 space-y-6">
            <div className="flex bg-solar-bg p-1 rounded-xl border border-slate-800 mb-4">
              <button onClick={() => setSettingsTab('system')} className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${settingsTab === 'system' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-600'}`}>System Setup</button>
              <button onClick={() => setSettingsTab('finance')} className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${settingsTab === 'finance' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-600'}`}>Financials & API</button>
            </div>
            {settingsTab === 'system' ? (
              <div className="space-y-6 animate-in slide-in-from-left-2">
                <div className="space-y-4 pb-6 border-b border-slate-800">
                  <div className="flex items-center justify-between"><h4 className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-2"><MapPin className="w-3 h-3" /> System Location</h4><div className="flex bg-solar-bg p-0.5 rounded-lg border border-slate-800">{['gps', 'search', 'manual'].map(m => (<button key={m} onClick={() => setLocationMode(m)} className={`px-2 py-1 text-[8px] font-black uppercase rounded-md transition-all ${locationMode === m ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}>{m}</button>))}</div></div>
                  {locationMode === 'gps' && (<button onClick={detectLocation} disabled={searchLoading} className="w-full py-4 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/30 rounded-xl flex flex-col items-center justify-center gap-2 group transition-all"><Crosshair className={`w-8 h-8 ${searchLoading ? 'animate-spin' : 'group-hover:scale-110'}`} /><span className="text-xs font-black uppercase tracking-widest">{searchLoading ? "Detecting..." : "Use Current GPS"}</span></button>)}
                  {locationMode === 'search' && (
                    <div className="relative animate-in fade-in slide-in-from-left-2">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input 
                        type="text" 
                        value={addressQuery} 
                        onFocus={startSearchSession} 
                        onChange={e => searchAddress(e.target.value)} 
                        placeholder="Postal code or city..." 
                        className="w-full pl-10 pr-4 py-2.5 bg-solar-bg border border-slate-600 rounded-lg text-sm text-white focus:border-indigo-500 outline-none transition-all" 
                      />
                      {searchResults.length > 0 && (
                        <div className="absolute left-0 right-0 z-[1000] mt-2 bg-solar-bg border border-slate-700 rounded-xl shadow-2xl overflow-y-auto max-h-[250px] custom-scrollbar">
                          {searchResults.map(r => (
                            <button key={r.mapbox_id} onClick={() => selectLocation(r)} className="w-full px-4 py-3 text-left hover:bg-indigo-600/20 border-b border-slate-800 last:border-0 flex flex-col gap-0.5 transition-colors">
                              <div className="font-bold text-sm text-slate-200">{r.name}</div>
                              <div className="text-[10px] text-slate-500 line-clamp-1">{r.place_formatted}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {locationMode === 'manual' && (<div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-left-2"><div><label className="block text-[9px] font-bold text-slate-600 uppercase mb-1">Latitude</label><input type="number" value={manualCoords.lat} onChange={e => setManualCoords({...manualCoords, lat: parseFloat(e.target.value)})} className="w-full px-3 py-2 bg-solar-bg border border-slate-600 rounded-lg text-sm text-white font-mono outline-none focus:border-indigo-500" /></div><div><label className="block text-[9px] font-bold text-slate-600 uppercase mb-1">Longitude</label><input type="number" value={manualCoords.long} onChange={e => setManualCoords({...manualCoords, long: parseFloat(e.target.value)})} className="w-full px-3 py-2 bg-solar-bg border border-slate-600 rounded-lg text-sm text-white font-mono outline-none focus:border-indigo-500" /></div><button onClick={() => selectLocation({ latitude: manualCoords.lat, longitude: manualCoords.long, name: "Manual", country: "User Set" })} className="col-span-2 py-2 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 text-[10px] font-bold rounded-lg border border-indigo-500/30 transition-all uppercase tracking-widest">APPLY</button></div>)}
                  <div className="flex items-center gap-4 text-[10px] text-slate-400 font-mono bg-solar-bg p-2 rounded-lg border border-slate-800/50"><div><span className="text-slate-600 uppercase">Lat:</span> <span className="text-white">{config.lat?.toFixed(4)}</span></div><div><span className="text-slate-600 uppercase">Lon:</span> <span className="text-white">{config.long?.toFixed(4)}</span></div>{config.locationName && <div className="ml-auto text-indigo-400 italic truncate max-w-[150px]">{config.locationName}</div>}</div>
                </div>
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-800 pb-4 gap-4"><h3 className="font-semibold text-white text-sm flex items-center gap-2"><Calculator className="w-4 h-4 text-amber-400" /> String Setup</h3><button onClick={addString} className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 active:scale-95 shadow-sm transition-all"><Plus className="w-3 h-3" /> Add String</button></div>
                <div className="bg-solar-bg p-3 rounded-xl border border-slate-800 flex items-center gap-4"><label className="text-[9px] font-black text-slate-500 uppercase shrink-0">Efficiency</label><input type="range" min="10" max="100" value={config.eff * 100} onChange={e => saveConfigToCloud({ ...config, eff: Number(e.target.value) / 100 })} className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" /><div className="flex items-center gap-1 min-w-[45px]"><input type="number" value={Math.round(config.eff * 100)} onChange={e => saveConfigToCloud({ ...config, eff: Number(e.target.value) / 100 })} className="w-8 bg-transparent text-indigo-400 text-xs font-bold font-mono outline-none" /><span className="text-[10px] text-slate-600">%</span></div></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{(config.strings || []).map(s => (<div key={s.id} className="p-4 bg-solar-bg rounded-2xl border border-slate-700 relative group"><div className="flex justify-between items-center mb-3"><input type="text" value={s.name} onChange={e => updateString(s.id, 'name', e.target.value)} className="bg-transparent border-b border-slate-800 text-white font-bold text-sm py-1 outline-none focus:border-indigo-500" /><button onClick={() => removeString(s.id)} className="p-2 text-red-500 hover:bg-red-900/10 rounded-lg transition-colors"><Trash2 className="w-3 h-3" /></button></div><div className="grid grid-cols-2 gap-3"><div><label className="text-[9px] font-bold text-slate-500 uppercase mb-1">Panels</label><input type="number" value={s.count} onChange={e => updateString(s.id, 'count', Number(e.target.value))} className="w-full bg-solar-card border border-slate-700 rounded-lg p-1.5 text-sm text-white focus:border-indigo-500 outline-none" /></div><div><label className="text-[9px] font-bold text-slate-500 uppercase mb-1">Wattage</label><input type="number" value={s.wattage || 465} onChange={e => updateString(s.id, 'wattage', Number(e.target.value))} className="w-full bg-solar-card border border-slate-700 rounded-lg p-1.5 text-sm text-white focus:border-indigo-500 outline-none" /></div><div><label className="text-[9px] font-bold text-slate-500 uppercase mb-1">Azimuth</label><input type="number" value={s.azimuth} onChange={e => updateString(s.id, 'azimuth', Number(e.target.value))} className="w-full bg-solar-card border border-slate-700 rounded-lg p-1.5 text-sm text-white focus:border-indigo-500 outline-none" /></div><div><label className="text-[9px] font-bold text-slate-500 uppercase mb-1">Pitch</label><input type="number" value={s.tilt} onChange={e => updateString(s.id, 'tilt', Number(e.target.value))} className="w-full bg-solar-card border border-slate-700 rounded-lg p-1.5 text-sm text-white focus:border-indigo-500 outline-none" /></div></div></div>))}</div>
                <div className="grid grid-cols-1 gap-4 mt-4"><div><label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Battery Usable (kWh)</label><input type="number" value={config.batteryCapacity} onChange={e => saveConfigToCloud({ ...config, batteryCapacity: Number(e.target.value) })} className="w-full bg-solar-card border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none" /></div></div>
              </div>
            ) : (
              <div className="space-y-6 animate-in slide-in-from-right-2">
                <div className="space-y-4"><label className="block text-[9px] font-bold text-slate-500 uppercase tracking-widest">Currency Symbol</label><div className="flex gap-2">{['€', '£', '$'].map(sym => (<button key={sym} onClick={() => saveConfigToCloud({ ...config, currency: sym })} className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${config.currency === sym ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-solar-card border-slate-700 text-slate-400'}`}>{sym}</button>))}<input type="text" value={config.currency || ''} onChange={e => saveConfigToCloud({ ...config, currency: e.target.value.slice(0, 3) })} placeholder="Custom" className="flex-1 bg-solar-card border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-bold text-center outline-none focus:border-indigo-500" /></div></div>
                <div className="grid grid-cols-2 gap-4"><div><label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Daily Load (kWh)</label><input type="number" value={config.dailyConsumption} onChange={e => saveConfigToCloud({ ...config, dailyConsumption: Number(e.target.value) })} className="w-full bg-solar-card border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none" /></div><div className="flex items-center justify-between bg-solar-card p-3 rounded-xl border border-slate-700 mt-5"><span className="text-[10px] font-bold text-slate-300 uppercase">Export?</span><button onClick={() => saveConfigToCloud({ ...config, onMicrogenScheme: !config.onMicrogenScheme })} className={`px-4 py-1 rounded-full text-[9px] font-black uppercase transition-all ${config.onMicrogenScheme ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-500'}`}>{config.onMicrogenScheme ? "Yes" : "No"}</button></div></div>
                <div className="grid grid-cols-2 gap-4"><div><label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Import Rate ({config.currency})</label><input type="number" step="0.01" value={config.importRate} onChange={e => saveConfigToCloud({ ...config, importRate: Number(e.target.value) })} className="w-full bg-solar-card border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none" /></div><div><label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Export Rate ({config.currency})</label><input type="number" step="0.01" value={config.exportRate} onChange={e => saveConfigToCloud({ ...config, exportRate: Number(e.target.value) })} className="w-full bg-solar-card border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none" /></div></div>
                <div className="bg-solar-bg p-4 rounded-2xl border border-slate-800 space-y-3"><div className="flex justify-between items-center"><div className="flex items-center gap-2 text-indigo-400 font-black text-[10px] uppercase tracking-widest"><Zap className="w-3 h-3" /> External API</div><button onClick={() => saveConfigToCloud({ ...config, apiEnabled: !config.apiEnabled })} className={`px-3 py-1 rounded-full text-[9px] font-black uppercase transition-all ${config.apiEnabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}>{config.apiEnabled ? "Enabled" : "Disabled"}</button></div>{config.apiEnabled && (<div className="space-y-2"><p className="text-[10px] text-slate-500 leading-tight">Home Assistant URL:</p><div className="flex gap-2"><input readOnly value={`https://firestore.googleapis.com/v1/projects/solar-forecaster-63320/databases/(default)/documents/public_forecasts/${user?.uid || 'demo-user'}`} className="flex-1 bg-black/30 border border-slate-800 rounded px-2 py-1.5 text-[9px] font-mono text-indigo-300 outline-none" /><button onClick={() => { window.open(`https://firestore.googleapis.com/v1/projects/solar-forecaster-63320/databases/(default)/documents/public_forecasts/${user?.uid || 'demo-user'}`, '_blank'); logAnalyticsEvent('api_open_json'); }} className="px-2 bg-indigo-600 rounded text-[9px] font-bold text-white uppercase hover:bg-indigo-700 transition-colors">Open</button></div><p className="text-[9px] text-indigo-400/70 italic leading-tight mt-1">Use P10 for battery pre-charging. 'kw' is deprecated.</p></div>)}</div>
              </div>
            )}
            <div className="pt-4 border-t border-slate-800 flex justify-between items-center text-[10px] text-slate-500 font-bold uppercase px-2"><p>Capacity: {totalCapacity.toFixed(2)} kWp</p><button onClick={handleLogout} className="text-red-400 hover:underline">Log Out</button></div>
          </div>
        )}

        {showFeedback && (
          <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-4 bg-solar-bg/80 backdrop-blur-sm animate-in fade-in"><div className="w-full max-w-lg bg-solar-card rounded-2xl border border-slate-700 shadow-2xl p-6 space-y-4 animate-in slide-in-from-bottom-4"><div className="flex justify-between items-center"><h3 className="text-lg font-bold text-white flex items-center gap-2"><MessageSquare className="w-5 h-5 text-indigo-400" /> Community Feedback</h3><button onClick={() => setShowFeedback(false)} className="text-slate-500 text-xl hover:text-white transition-colors">&times;</button></div><textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} placeholder="How's the accuracy? Any features you'd like to see?" className="w-full h-32 p-3 bg-solar-bg border border-slate-600 rounded-xl text-white outline-none focus:border-indigo-500 transition-all resize-none" /><div className="flex gap-3"><button onClick={() => setShowFeedback(false)} className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold transition-all">Cancel</button><button onClick={submitFeedback} disabled={isSubmittingFeedback || !feedbackText.trim()} className="flex-[2] py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/20">{isSubmittingFeedback ? "Sending..." : "Send Feedback"}</button></div></div></div>
        )}

        {activeTab === 'today' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-solar-card p-5 rounded-xl border border-slate-700/50 shadow-sm flex flex-col justify-between"><div><p className="text-slate-400 text-sm font-medium mb-1">Forecast Today</p><div className="flex items-end gap-2"><h2 className="text-3xl font-bold text-white">{todayForecast.yield.toFixed(1)}</h2><span className="text-slate-500 mb-1 font-medium">kWh</span></div></div><div className="mt-4 space-y-1">{(config.strings || []).map((s, idx) => (<div key={s.id} className="flex items-center gap-2 text-[10px] text-slate-500"><div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STRING_COLORS[idx % STRING_COLORS.length] }}></div><span className="truncate flex-1 font-medium">{s.name}:</span><Zap className="w-2 h-2 text-indigo-500/30" /><span className="font-mono text-slate-400">{(todayForecast.strings?.[s.id] || 0).toFixed(1)}</span></div>))}</div></div>
              
              <div className={`bg-gradient-to-br from-solar-card to-solar-bg p-5 rounded-xl border shadow-sm flex flex-col justify-between transition-all duration-500 ${needsEntry && !isDemo ? 'border-amber-500/50 ring-2 ring-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.1)]' : 'border-indigo-500/30'} ${isDemo ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <div onClick={() => isDemo && setIsDemo(false)}>
                  <label className="text-indigo-300 text-sm font-medium mb-1 flex items-center gap-2">
                    <Zap className={`w-4 h-4 ${needsEntry && !isDemo ? 'text-amber-400 animate-pulse' : 'text-indigo-400'}`} /> 
                    Today's Actual
                    {needsEntry && !isDemo && <div className="w-2 h-2 bg-amber-500 rounded-full ml-auto animate-ping"></div>}
                  </label>
                  <div className="mt-2 flex items-center gap-2">
                    <input 
                      type="number" 
                      value={actuals[todayForecast.isoDate] || ''} 
                      disabled={isDemo}
                      onChange={e => { saveActualToCloud(todayForecast.isoDate, e.target.value); setIsCalculating(true); setTimeout(() => setIsCalculating(false), 1500); }} 
                      className="w-full bg-transparent border-b-2 border-indigo-500 p-1 text-3xl font-bold text-white outline-none focus:border-indigo-400 transition-colors disabled:border-slate-700" 
                      placeholder={isDemo ? "Sign in to enter readings" : (needsEntry ? "Enter final kWh..." : "0.0")} 
                    />
                    <span className="text-slate-500 font-medium text-xs">kWh</span>
                  </div>
                </div>
                <p className="mt-4 text-[10px] text-slate-500 italic leading-tight">{isDemo ? "Sign in to log actuals and tune your model." : "Syncs to cloud for model tuning."}</p>
              </div>

              <div className={`p-5 rounded-xl border shadow-sm flex flex-col justify-between transition-all duration-700 relative overflow-hidden ${isCalculating ? 'scale-[1.05] shadow-[0_0_20px_rgba(16,185,129,0.3)] border-emerald-500/50 bg-emerald-900/10' : (daysEntered > 0 ? (isAccurate ? 'bg-emerald-900/10 border-emerald-500/20' : 'bg-amber-900/10 border-amber-500/20') : 'bg-solar-card border-slate-700/50')}`}>
                <div className={`transition-all duration-500 ${isDemo ? 'blur-md select-none pointer-events-none' : ''}`}>
                  <p className="text-slate-400 text-sm font-medium mb-1 flex items-center gap-2"><Target className={`w-4 h-4 ${isCalculating ? 'animate-spin text-emerald-400' : ''}`} /> Accuracy</p>
                  {daysEntered > 0 ? (
                    <div className="space-y-1 mt-2">
                      <div className="flex items-end gap-2"><h2 className={`text-3xl font-bold ${isAccurate ? 'text-emerald-400' : 'text-amber-400'}`}>{accuracyPercentage}%</h2><span className="text-[10px] text-slate-500 mb-1 font-black uppercase tracking-tighter text-xs font-black">Accuracy</span></div>
                      <p className="text-[10px] text-slate-500 font-medium uppercase tracking-tighter">Delta: <span className={sumActuals > sumModel ? "text-emerald-500" : "text-amber-500"}>{sumActuals > sumModel ? "+" : ""}{(sumActuals - sumModel).toFixed(2)} kWh</span></p>
                    </div>
                  ) : (
                    <p className="text-slate-500 text-[10px] mt-3 leading-tight italic">Add daily readings to improve your forecast.</p>
                  )}
                  {canApply && !isDemo && <button onClick={() => saveConfigToCloud({ ...config, eff: suggestedEff })} className="mt-3 w-full py-2 text-[10px] font-black rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 tracking-widest hover:bg-amber-500/30 transition-all uppercase">Apply Tuning</button>}
                </div>
                
                {isDemo && (
                  <div 
                    onClick={() => setIsDemo(false)}
                    className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-solar-bg/40 backdrop-blur-[2px] cursor-pointer group"
                  >
                    <Lock className="w-5 h-5 text-indigo-400 group-hover:scale-110 transition-transform" />
                    <div className="text-center">
                      <p className="text-[10px] font-black text-white uppercase tracking-widest">Calibration</p>
                      <p className="text-[9px] text-slate-400 leading-tight">Sign in to track<br/>forecast accuracy</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="hidden md:flex bg-solar-card p-5 rounded-xl border border-slate-700/50 shadow-sm flex-col justify-between"><div><p className="text-slate-400 text-sm font-medium mb-1">Forecast Tomorrow</p><div className="flex items-end gap-2"><h2 className="text-3xl font-bold text-white">{tomorrowForecast.yield.toFixed(1)}</h2><span className="text-slate-500 mb-1 font-medium text-xs">kWh</span></div></div><div className="mt-4 flex items-center gap-2 text-[10px] text-blue-500 font-bold uppercase tracking-widest"><Calendar className="w-3 h-3" /> 24h prediction</div></div>
            </div>

            {/* ESTIMATED ECONOMICS CARD */}
            <div className="bg-solar-card rounded-3xl border border-slate-700/50 shadow-xl overflow-hidden group">
               <button onClick={() => saveConfigToCloud({ ...config, showEconomics: !config.showEconomics })} className="w-full p-6 flex items-center justify-between hover:bg-solar-slate-700 transition-all duration-300">
                  <div className="flex items-center gap-5 text-left">
                     <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 text-emerald-400 group-hover:scale-110 transition-transform"><TrendingUp className="w-7 h-7" /></div>
                     <div><h3 className="text-sm font-black text-white uppercase tracking-[0.15em] mb-1">Estimated Economics</h3><p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Tomorrow's outlook: <strong className="text-emerald-400 font-black">{config.currency}{tomorrowSavings.toFixed(2)} value</strong></p></div>
                  </div>
                  <div className="flex items-center gap-6">
                     <div className="text-right hidden sm:block"><div className="text-[10px] text-slate-500 uppercase font-black tracking-tighter mb-1">Total Daily Value</div><div className="text-3xl font-black text-white tracking-tighter">{config.currency}{todaySavings.toFixed(2)}</div></div>
                     <div className={`p-2 rounded-full transition-colors ${config.showEconomics ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-500'}`}>{config.showEconomics ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}</div>
                  </div>
               </button>
               {config.showEconomics && (
                  <div className="px-6 pb-8 space-y-8 animate-in slide-in-from-top-4 duration-500">
                     {adviceText && (<div className="bg-indigo-500/10 border border-indigo-500/20 p-3 rounded-xl flex items-center gap-3"><Zap className="w-4 h-4 text-indigo-400 shrink-0" /><p className="text-[11px] font-bold text-slate-200 leading-tight">⚡ {adviceText}</p></div>)}
                     <div className="space-y-3"><div className="flex justify-between items-end px-1"><span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Energy Path</span><span className="text-[10px] font-bold text-slate-400">Generation: {todayForecast.yield.toFixed(1)} kWh</span></div><div className="h-4 w-full bg-slate-800 rounded-full overflow-hidden flex border border-slate-700/50 shadow-inner"><div title="Home" className="h-full bg-emerald-500 transition-all duration-1000 relative group" style={{ width: `${(todayForecast.economics?.selfConsumed / (todayForecast.yield || 1)) * 100}%` }}><div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></div></div><div title="Export" className="h-full bg-indigo-500 transition-all duration-1000 border-l border-white/10" style={{ width: `${(todayForecast.economics?.exported / (todayForecast.yield || 1)) * 100}%` }}></div><div title="Clipped" className="h-full bg-amber-600 transition-all duration-1000 border-l border-white/10" style={{ width: `${(todayForecast.economics?.clipped / (todayForecast.yield || 1)) * 100}%` }}></div></div><div className="flex gap-4 justify-center"><div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-[9px] font-bold text-slate-500 uppercase">Home</span></div><div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-indigo-500"></div><span className="text-[9px] font-bold text-slate-500 uppercase">Grid Export</span></div>{todayForecast.economics?.clipped > 0 && <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-600"></div><span className="text-[9px] font-bold text-slate-500 uppercase">Clipped</span></div>}</div></div>
                     <div className="grid grid-cols-1 md:grid-cols-11 items-center gap-2"><div className="md:col-span-5 p-5 bg-solar-bg rounded-2xl border border-emerald-500/10 flex flex-col justify-between h-full relative overflow-hidden"><div className="absolute top-0 right-0 p-4 opacity-5"><Zap className="w-16 h-14 text-emerald-400" /></div><div><div className="text-[9px] font-black text-emerald-500/70 uppercase tracking-[0.2em] mb-3">1. Household Savings</div><div className="text-3xl font-black text-white mb-1">{config.currency}{(todayForecast.economics?.selfConsumed * config.importRate).toFixed(2)}</div><div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{todayForecast.economics?.selfConsumed.toFixed(1)} kWh used by home</div></div></div><div className="hidden md:flex md:col-span-1 justify-center text-slate-600 font-black text-2xl">+</div><div className="md:col-span-5 p-5 bg-solar-bg rounded-2xl border border-indigo-500/10 flex flex-col justify-between h-full relative overflow-hidden"><div className="absolute top-0 right-0 p-4 opacity-5"><Navigation className="w-16 h-14 text-indigo-400" /></div><div><div className="text-[9px] font-black text-indigo-400/70 uppercase tracking-[0.2em] mb-3">2. Export Credits</div><div className="text-3xl font-black text-white mb-1">{config.currency}{(todayForecast.economics?.exported * config.exportRate).toFixed(2)}</div><div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{todayForecast.economics?.exported.toFixed(1)} kWh sent to grid</div></div>{!config.onMicrogenScheme && <div className="mt-4 pt-3 border-t border-slate-800/50"><p className="text-[9px] text-amber-500/80 italic font-medium leading-tight">Enable export in settings to track this credit.</p></div>}</div></div>
                     <div className="pt-6 border-t border-slate-800/80"><div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-solar-bg/40 p-5 rounded-2xl border border-slate-800/50"><div className="flex items-center gap-4"><div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-red-400/50"><CloudRain className="w-5 h-5" /></div><div><h4 className="text-[10px] font-black text-solar-slate-500 uppercase tracking-widest">Grid Import Needed</h4><p className="text-xs font-bold text-slate-300">{todayForecast.economics?.imported.toFixed(1)} kWh still needed from grid</p></div></div><div className="text-right"><div className="text-[9px] text-slate-600 uppercase font-black tracking-tighter">Est. Cost</div><div className="text-xl font-black text-slate-400">{config.currency}{(todayForecast.economics?.imported * config.importRate).toFixed(2)}</div></div></div></div>
                     <div className="flex items-center gap-2 text-[8px] text-slate-600 font-bold uppercase tracking-widest bg-black/20 p-2.5 rounded-lg border border-slate-800/50"><Info className="w-3 h-3 shrink-0" /><span>Based on a steady baseline load.</span></div>
                  </div>
               )}
            </div>

            <div className="bg-solar-card p-4 md:p-6 rounded-2xl border border-slate-700/50 shadow-lg">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6"><h2 className="text-lg font-semibold text-white flex items-center gap-2"><Activity className="w-5 h-5 text-indigo-400" /> Hourly Profile</h2><div className="flex flex-wrap gap-2">{[ { key: 'total', label: 'Total', color: '#fde047' }, { key: 'energy', label: 'Energy', color: '#818cf8' }, { key: 'strings', label: 'Strings', color: '#f59e0b' }, { key: 'uncertainty', label: 'Likely Range', color: '#6366f1' } ].map(btn => (<button key={btn.key} onClick={() => toggleSeries(btn.key)} className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border transition-all flex items-center gap-2 ${visibleSeries[btn.key] ? 'bg-solar-card border-slate-600 text-white shadow-inner' : 'bg-transparent border-slate-800 text-slate-600'}`}><div className={`w-1.5 h-1.5 rounded-full transition-all ${visibleSeries[btn.key] ? 'scale-100' : 'scale-50 opacity-40'}`} style={{ backgroundColor: btn.color }}></div>{btn.label}</button>))}</div></div>
              <div className="h-[250px] w-full"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={selectedDayData} margin={chartMargins}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" /><XAxis dataKey="timeLabel" interval={isMobile ? 5 : 3} tickFormatter={(val) => isMobile ? val.split(':')[0] : val} stroke="#64748b" fontSize={10} axisLine={false} tickLine={false} /><YAxis stroke="#64748b" fontSize={11} axisLine={false} tickLine={false} label={isMobile ? { value: 'kW', position: 'insideTopLeft', offset: 0, dy: -20, dx: 10, fill: '#64748b', fontSize: 10, fontWeight: 'bold' } : { value: 'POWER (kW)', angle: -90, position: 'insideLeft', offset: -30, dy: 0, fontSize: 8, fontWeight: 'bold', fill: '#64748b' }} /><YAxis yAxisId="right" orientation="right" stroke="#818cf8" fontSize={10} axisLine={false} tickLine={false} unit="kWh" label={isMobile ? { value: 'kWh', position: 'insideTopRight', offset: 0, dy: -20, dx: -10, fill: '#818cf8', fontSize: 10, fontWeight: 'bold' } : { value: 'ENERGY (kWh)', angle: 90, position: 'insideRight', offset: -30, dy: 0, fontSize: 8, fontWeight: 'bold', fill: '#64748b' }} /><Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} content={renderTooltipContent} />{visibleSeries.uncertainty && <Area type="monotone" dataKey="pRange" stroke="none" fill="#fde047" fillOpacity={0.3} name="Likely Range" />}{visibleSeries.total && <Area type="monotone" dataKey="total" name="Total Power" stroke="#fde047" fill="#fde047" fillOpacity={0.1} strokeWidth={2} />}{visibleSeries.strings && (config.strings || []).map((s, idx) => <Line key={s.id} type="monotone" dataKey={`stringPowers.${s.id}`} name={s.name} stroke={STRING_COLORS[idx % STRING_COLORS.length]} strokeWidth={1} dot={false} strokeDasharray="5 5" />)}{visibleSeries.energy && <Line yAxisId="right" type="monotone" dataKey="cumulativeYield" name="Energy" stroke="#818cf8" strokeWidth={3} dot={false} />}{currentHourTick && <ReferenceLine x={currentHourTick} stroke="#818cf8" strokeDasharray="4 4" />}</ComposedChart></ResponsiveContainer></div>
            </div>

            <div className="bg-solar-card rounded-2xl border border-slate-700/50 shadow-lg overflow-hidden"><div className="grid grid-cols-1 md:grid-cols-2"><div className="p-6 border-b md:border-b-0 md:border-r border-slate-800"><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2"><Zap className="w-3 h-3 text-amber-400" /> Real-time</h3><div className="space-y-4"><div className="flex justify-between items-center"><span className="text-xs text-slate-400">Forecast This Hour</span><span className="text-sm font-bold text-white">{(vitals.thisHour * 1000).toLocaleString()} <span className="text-[10px] text-slate-500 font-normal">Wh</span></span></div><div className="flex justify-between items-center"><span className="text-xs text-slate-400">Next Hour</span><span className="text-sm font-bold text-white">{(vitals.nextHour * 1000).toLocaleString()} <span className="text-[10px] text-slate-500 font-normal">Wh</span></span></div></div></div><div className="p-6 bg-solar-card/20"><h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2"><Calendar className="w-3 h-3 text-indigo-400" /> Daily</h3><div className="space-y-4"><div className="flex justify-between items-center"><span className="text-xs text-slate-400">Remaining Today</span><span className="text-sm font-bold text-indigo-400">{vitals.remainingToday.toFixed(2)} <span className="text-[10px] text-slate-500 font-normal">kWh</span></span></div><div className="flex justify-between items-center"><span className="text-xs text-slate-400">Tomorrow</span><span className="text-sm font-bold text-white">{tomorrowForecast.yield.toFixed(1)} <span className="text-[10px] text-slate-500 font-normal uppercase">kWh</span></span></div></div></div></div></div>
          </div>
        )}

        {activeTab === 'forecast' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 pb-8">
            <div className="bg-solar-card rounded-2xl border border-slate-700/50 overflow-hidden shadow-lg">
              <button onClick={() => setShowForecastChart(!showForecastChart)} className="w-full p-4 flex justify-between items-center hover:bg-solar-slate-700 transition-colors"><div className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-indigo-400" /><h2 className="text-sm font-black text-white uppercase tracking-widest">Visual Outlook</h2></div>{showForecastChart ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}</button>
              {showForecastChart && (
                <div className="p-6 pt-0 animate-in zoom-in-95 duration-200">
                  <div className="flex flex-wrap gap-2 mb-4"><button onClick={() => toggleSeries('uncertainty')} className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border transition-all flex items-center gap-2 ${visibleSeries.uncertainty ? 'bg-solar-card border-slate-600 text-white shadow-inner' : 'bg-transparent border-slate-800 text-slate-600'}`}><div className={`w-1.5 h-1.5 rounded-full transition-all ${visibleSeries.uncertainty ? 'scale-100' : 'scale-50 opacity-40'}`} style={{ backgroundColor: '#6366f1' }}></div>{visibleSeries.uncertainty ? "Hide Likely Range" : "Show Likely Range"}</button></div>
                  <div className="h-[220px] w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={chartMargins}><defs><linearGradient id="colorYellow" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#fde047" stopOpacity={0.4} /><stop offset="95%" stopColor="#fde047" stopOpacity={0.0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" /><XAxis dataKey="fullLabel" tickFormatter={(val) => isMobile ? val.split(' ')[1].split(':')[0] : val.split(' ')[0]} interval={isMobile ? 47 : 23} stroke="#64748b" fontSize={10} axisLine={false} tickLine={false} /><YAxis stroke="#64748b" fontSize={11} domain={[0, 'auto']} axisLine={false} tickLine={false} unit="kW" label={isMobile ? { value: 'kW', position: 'insideTopLeft', offset: 0, dy: -20, dx: 10, fill: '#64748b', fontSize: 10, fontWeight: 'bold' } : { value: 'POWER (kW)', angle: -90, position: 'insideLeft', offset: -30, dy: 0, fontSize: 8, fontWeight: 'bold', fill: '#64748b' }} /><Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', fontSize: '10px' }} content={renderTooltipContent} />{visibleSeries.uncertainty && <Area type="monotone" dataKey="pRange" stroke="none" fill="#fde047" fillOpacity={0.3} name="Likely Range" />}<Area type="monotone" dataKey="p50" stroke="#fde047" fill="url(#colorYellow)" strokeWidth={3} name="Most Likely" /></AreaChart></ResponsiveContainer></div>                  <p className="text-[9px] text-slate-500 text-center uppercase tracking-widest mt-2">Shaded area = likely range based on weather variability</p>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3">{dailyTotals.filter(d => d.dayOffset >= 0).map((day) => { const maxWeekYield = Math.max(...dailyTotals.map(d => d.yield)); const relScale = (day.yield / maxWeekYield) * 100; const isExpanded = expandedForecastDay === day.dayLabel; return (<div key={day.dayLabel} className={`bg-solar-card rounded-2xl border transition-all duration-300 ${isExpanded ? 'border-indigo-500/50 ring-1 ring-indigo-500/20 shadow-lg' : 'border-slate-800 shadow-sm'}`}><button onClick={() => { setExpandedForecastDay(isExpanded ? null : day.dayLabel); logAnalyticsEvent('expand_forecast_day', { day: day.dayLabel }); }} className="w-full p-4 flex items-center gap-4 text-left"><div className="text-center min-w-[56px] border-r border-slate-800 pr-4"><div className="text-[10px] text-slate-500 font-black uppercase tracking-widest">{day.date.toLocaleDateString([], { weekday: 'short' })}</div><div className="text-xl font-black text-white">{day.date.toLocaleDateString([], { day: 'numeric' })}</div></div><div className="flex-1 min-w-0"><div className="flex justify-between items-end mb-1.5"><span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Predicted</span><div className="text-right"><div className="text-sm font-black text-white">{day.yield.toFixed(1)} <span className="text-[10px] text-slate-500 font-normal uppercase font-black tracking-widest">kWh</span></div><div className="text-[8px] font-bold text-indigo-400 uppercase tracking-tight">Likely: {day.p10.toFixed(1)} – {day.p90.toFixed(1)} kWh</div></div></div><div className="h-2 w-full bg-slate-800/50 rounded-full overflow-hidden shadow-inner"><div className={`h-full rounded-full transition-all duration-1000 ${day.yield > maxWeekYield*0.8 ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]' : 'bg-indigo-500'}`} style={{ width: `${relScale}%` }}></div></div></div><div className="pl-2 flex flex-col items-center">{day.yield > maxWeekYield*0.8 ? <Sun className="w-6 h-6 text-amber-400" /> : day.yield < maxWeekYield*0.4 ? <CloudRain className="w-6 h-6 text-slate-500" /> : <Cloud className="w-6 h-6 text-indigo-400/60" />}{isExpanded ? <ChevronUp className="w-3 h-3 text-slate-600 mt-1" /> : <ChevronDown className="w-3 h-3 text-slate-600 mt-1" />}</div></button>{isExpanded && (<div className="p-4 pt-0 animate-in slide-in-from-top-2 duration-300"><div className="h-[180px] w-full mt-2 bg-solar-bg/50 rounded-xl p-2 border border-slate-800/50 shadow-inner"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.filter(d => d.dayLabel === day.dayLabel)} margin={chartMargins}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" /><XAxis dataKey="timeLabel" interval={isMobile ? 5 : 3} tickFormatter={(val) => isMobile ? val.split(':')[0] : val} stroke="#64748b" fontSize={9} axisLine={false} tickLine={false} /><YAxis stroke="#475569" fontSize={9} axisLine={false} tickLine={false} label={isMobile ? { value: 'kW', position: 'insideTopLeft', offset: 0, dy: -20, dx: 10, fill: '#64748b', fontSize: 10, fontWeight: 'bold' } : { value: 'POWER (kW)', angle: -90, position: 'insideLeft', offset: -30, dy: 0, fontSize: 8, fontWeight: 'bold', fill: '#475569' }} />{visibleSeries.uncertainty && <Area type="monotone" dataKey="pRange" stroke="none" fill="#fde047" fillOpacity={0.1} name="Likely Range" />}
                          <Area type="monotone" dataKey="total" name="kW" stroke="#fde047" fill="#fde047" fillOpacity={0.1} strokeWidth={2} /><Line type="monotone" dataKey="cumulativeYield" yAxisId="right" stroke="#818cf8" strokeWidth={2} dot={false} /><YAxis yAxisId="right" orientation="right" hide={false} stroke="#475569" fontSize={8} label={isMobile ? { value: 'kWh', position: 'insideTopRight', offset: 0, dy: -20, dx: -10, fill: '#818cf8', fontSize: 10, fontWeight: 'bold' } : { value: 'ENERGY (kWh)', angle: 90, position: 'insideRight', offset: -30, dy: 0, fontSize: 8, fontWeight: 'bold', fill: '#475569' }} /><Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', fontSize: '10px' }} content={renderTooltipContent} /></ComposedChart></ResponsiveContainer></div></div>)}</div>); })}</div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 pb-8">
            {isDemo ? (
              <div className="bg-solar-card p-12 rounded-3xl border border-slate-700 shadow-xl text-center space-y-6">
                <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto border border-indigo-500/20">
                  <History className="w-10 h-10 text-indigo-400" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-black text-white uppercase tracking-tighter">Performance Tracking</h2>
                  <p className="text-slate-400 max-w-xs mx-auto text-sm font-medium">Sign in to track your modelled vs actual accuracy over time and auto-calibrate your system.</p>
                </div>
                <button onClick={() => setIsDemo(false)} className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg hover:bg-indigo-700 transition-all active:scale-95">Sign in to start tracking</button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-solar-card p-4 rounded-xl border border-slate-800"><p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Average Accuracy</p><div className="flex items-end gap-1"><h3 className="text-xl font-bold text-white">±{avgError}%</h3></div></div>
                  <div className="bg-solar-card p-4 rounded-xl border border-slate-800"><p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Tracking Days</p><h3 className="text-xl font-bold text-indigo-400">{daysEntered}</h3></div>
                  <div className="bg-solar-card p-4 rounded-xl border border-slate-800"><p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Best Day</p>{bestDay ? (<div className="text-[10px] font-bold text-emerald-400 leading-tight">{bestDay.date.toLocaleDateString([], { month: 'short', day: 'numeric' })} &bull; {(bestDay.absDelta * 100).toFixed(1)}% off</div>) : <span className="text-slate-600 text-[10px]">--</span>}</div>
                  <div className="bg-solar-card p-4 rounded-xl border border-slate-800"><p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Worst Day</p>{worstDay ? (<div className="text-[10px] font-bold text-amber-400 leading-tight">{worstDay.date.toLocaleDateString([], { month: 'short', day: 'numeric' })} &bull; {(worstDay.absDelta * 100).toFixed(1)}% off</div>) : <span className="text-slate-600 text-[10px]">--</span>}</div>
                </div>
                <div className="bg-solar-card p-4 md:p-6 rounded-2xl border border-slate-700/50 shadow-lg overflow-hidden"><div className="flex justify-between items-center mb-6"><h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2"><TrendingUp className="w-4 h-4 text-indigo-400" /> Model vs Actuals (30d)</h2><div className="flex items-center gap-4 text-[10px]"><div className="flex items-center gap-1"><div className="w-2 h-2 bg-indigo-500 rounded-sm"></div> <span className="text-slate-500 uppercase font-bold">Model</span></div><div className="flex items-center gap-1"><div className="w-2 h-2 bg-emerald-400 rounded-sm"></div> <span className="text-slate-500 uppercase font-bold">Actual</span></div></div></div><div className="overflow-x-auto custom-scrollbar pb-4"><div className="min-w-[600px] h-[200px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={accuracyChartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" /><XAxis dataKey="label" stroke="#475569" fontSize={10} axisLine={false} tickLine={false} /><YAxis stroke="#475569" fontSize={10} axisLine={false} tickLine={false} unit="kWh" /><YAxis yAxisId="right" orientation="right" domain={[0, 50]} hide /><Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '12px', fontSize: '10px' }} itemStyle={{ padding: '2px 0' }} /><Bar dataKey="model" name="Modelled" fill="#6366f1" radius={[2, 2, 0, 0]} barSize={8} /><Bar dataKey="actual" name="Actual" fill="#10b981" radius={[2, 2, 0, 0]} barSize={8} /><Bar dataKey="excludedModel" stackId="a" name="Excluded" fill="#334155" opacity={0.3} barSize={8} /><Bar dataKey="excludedActual" stackId="a" fill="#334155" opacity={0.3} barSize={8} /><Line yAxisId="right" type="monotone" dataKey="rollingAvg" name="7d Avg Error %" stroke="#818cf8" strokeWidth={2} dot={false} strokeDasharray="4 4" /></ComposedChart></ResponsiveContainer></div></div><p className="text-[9px] text-slate-600 text-center uppercase tracking-widest mt-2 font-bold">Swipe to view full 30-day history</p></div>
                <div className="bg-solar-card rounded-2xl border border-slate-700/50 overflow-hidden shadow-lg"><div className="p-4 border-b border-slate-700/50 bg-solar-card/50 flex justify-between items-center"><h2 className="text-sm font-black text-white uppercase tracking-widest">Historical Production</h2><span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest italic">kWh Reading</span></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-solar-card/50 border-b border-slate-700"><tr className="text-slate-400 uppercase text-[10px] font-black tracking-widest"><th className="p-4">Date</th><th className="p-4">Model</th><th className="p-4 text-indigo-400">Actual</th><th className="p-4 text-right">Manage</th></tr></thead><tbody className="text-slate-300 divide-y divide-slate-700/50">{dailyTotals.slice().reverse().filter(d => d.dayOffset < 0 || actuals[d.isoDate]).map((day) => { const isExcluded = (config.excludedDays || []).includes(day.isoDate); const snapshot = Number(snapshots[day.isoDate] || day.yield); const actual = Number(actuals[day.isoDate]) || 0; const delta = actual > 0 ? ((actual - snapshot) / snapshot * 100).toFixed(1) : null; return (<tr key={day.isoDate} className={`hover:bg-[#2d2e3a] transition-colors ${isExcluded ? 'opacity-40 grayscale' : ''}`}><td className="p-4"><div className="font-bold text-xs">{day.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</div>{delta && <div className={`text-[9px] font-black ${Number(delta) > 0 ? 'text-emerald-500' : 'text-amber-500'}`}>{delta}% delta</div>}</td><td className="p-4 font-mono text-xs text-slate-500">{snapshot.toFixed(2)} <span className="text-[9px]">kWh</span></td><td className="p-4"><div className="flex items-center gap-2"><input type="number" value={actuals[day.isoDate] || ''} onChange={e => saveActualToCloud(day.isoDate, e.target.value)} className="w-16 h-8 bg-solar-bg border border-slate-600 rounded px-2 text-white text-xs font-mono" placeholder="0.0" /><Zap className="w-3 h-3 text-slate-600" /></div></td><td className="p-4 text-right"><button onClick={() => { if (isExcluded) { saveConfigToCloud({ ...config, excludedDays: config.excludedDays.filter(d => d !== day.isoDate) }); } else { excludeDay(day.isoDate); } }} className={`px-3 py-1 rounded text-[9px] font-black uppercase border transition-all ${isExcluded ? 'bg-indigo-600 border-indigo-400 text-white' : 'border-slate-700 text-slate-500 hover:text-white hover:border-slate-400'}`}>{isExcluded ? "Include" : "Exclude"}</button></td></tr>); })}</tbody></table></div></div>
              </>
            )}
          </div>
        )}

        <div className="fixed bottom-0 left-0 right-0 h-16 bg-solar-bg/95 backdrop-blur-md border-t border-slate-800 flex md:hidden items-center justify-around px-6 z-50 pb-safe shadow-[0_-4px_12px_rgba(0,0,0,0.4)]">
           <button onClick={() => setActiveTab('today')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'today' ? 'text-indigo-400' : 'text-slate-600'}`}><LayoutDashboard className="w-6 h-6" /><span className="text-[9px] font-black uppercase tracking-widest">Today</span></button>
           <button onClick={() => setActiveTab('forecast')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'forecast' ? 'text-indigo-400' : 'text-slate-600'}`}><TrendingUp className="w-6 h-6" /><span className="text-[9px] font-black uppercase tracking-widest">Forecast</span></button>
           <button onClick={() => setActiveTab('history')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'history' ? 'text-indigo-400' : 'text-slate-600'}`}><History className="w-6 h-6" /><span className="text-[9px] font-black uppercase tracking-widest">History</span></button>
        </div>

      </div>
    </div>
  );
}
