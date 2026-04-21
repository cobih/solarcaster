import React, { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  ComposedChart, Line, Legend
} from 'recharts';
import {
  Sun, Calendar, Settings, AlertCircle, Info, Target, Calculator, Zap, Cloud,
  LogOut, LogIn, User
} from 'lucide-react';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, 
  GoogleAuthProvider, signInWithPopup, signOut 
} from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- FIREBASE INITIALIZATION ---
// const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- BASE CONSTANTS ---
const LATITUDE = 53.3767;
const LONGITUDE = -6.3286;
const PANEL_WATTAGE = 465;
const ALBEDO = 0.2;

// --- SOLAR PHYSICS ENGINE ---
const getSolarPosition = (date, lat, lon) => {
  const PI = Math.PI;
  const rad = PI / 180;
  const startOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const diff = date - startOfYear;
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
  const b = (360 / 365.24) * (dayOfYear - 81) * rad;
  const equationOfTime = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const declination = 23.45 * Math.sin(b);
  const lst = date.getUTCHours() + date.getUTCMinutes() / 60;
  const solarTime = lst + (4 * lon + equationOfTime) / 60;
  let hourAngle = 15 * (solarTime - 12);
  const latRad = lat * rad;
  const decRad = declination * rad;
  const haRad = hourAngle * rad;
  const sinElevation = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  const elevation = Math.asin(sinElevation);
  const cosAzimuth = (Math.sin(decRad) - Math.sin(latRad) * sinElevation) / (Math.cos(latRad) * Math.cos(elevation));
  let safeCosAz = Math.max(-1, Math.min(1, cosAzimuth));
  let azimuth = Math.acos(safeCosAz);
  if (hourAngle > 0) azimuth = 2 * PI - azimuth;
  return { elevation, azimuth, zenith: (PI / 2) - elevation };
};

const calculateArrayPower = (dni, dhi, temp, solarPos, panelAzimuthDeg, tiltDeg, capacityKw, efficiency) => {
  if (solarPos.elevation <= 0) return 0;
  const tiltRad = tiltDeg * (Math.PI / 180);
  const panelAzRad = panelAzimuthDeg * (Math.PI / 180);
  const cosAOI = Math.cos(solarPos.zenith) * Math.cos(tiltRad) + Math.sin(solarPos.zenith) * Math.sin(tiltRad) * Math.cos(solarPos.azimuth - panelAzRad);
  let poaDirect = 0;
  if (cosAOI > 0) poaDirect = dni * cosAOI;
  const poaDiffuse = dhi * ((1 + Math.cos(tiltRad)) / 2);
  const globalHorizontal = dni * Math.max(0, Math.cos(solarPos.zenith)) + dhi;
  const poaReflected = globalHorizontal * ALBEDO * ((1 - Math.cos(tiltRad)) / 2);
  const poaTotal = poaDirect + poaDiffuse + poaReflected;
  const cellTemp = temp + (poaTotal / 800) * (45 - 20);
  const tempDerating = 1 - Math.max(0, (cellTemp - 25) * 0.004);
  const power = (poaTotal / 1000) * capacityKw * efficiency * tempDerating;
  return Math.max(0, power);
};

export default function App() {
  // --- AUTH & DB STATE ---
  const [user, setUser] = useState(null);
  const [dbSyncing, setDbSyncing] = useState(true);

  // --- DATA STATE ---
  const [data, setData] = useState([]);
  const [dailyTotals, setDailyTotals] = useState([]);
  const [nowLabel, setNowLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // --- USER INPUTS (Dynamic State) ---
  const [config, setConfig] = useState({
    tilt: 35,
    eff: 0.85,
    eastCount: 11,
    westCount: 9,
  });

  const [actuals, setActuals] = useState({});
  const [showConfig, setShowConfig] = useState(false);
  const [selectedDayLabel, setSelectedDayLabel] = useState("");

  // Dynamic Capacities
  const capacityEast = (config.eastCount * PANEL_WATTAGE) / 1000;
  const capacityWest = (config.westCount * PANEL_WATTAGE) / 1000;
  const totalCapacity = capacityEast + capacityWest;

  // --- AUTH HANDLERS ---
  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login Error:", err);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      // Fallback to anonymous after logout if desired, 
      // or just let onAuthStateChanged handle the state.
    } catch (err) {
      console.error("Logout Error:", err);
    }
  };

  // --- 1. FIREBASE AUTH SETUP ---
  useEffect(() => {
    const initAuth = async () => {
      // only sign in anonymously if no one is signed in yet
      if (!auth.currentUser) {
        try {
          await signInAnonymously(auth);
        } catch (err) {
          console.error("Auth Error:", err);
        }
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        signInAnonymously(auth).catch(err => console.error("Auto-anon Error:", err));
      }
    });
    return () => unsubscribe();
  }, []);

  // --- 2. FIRESTORE DATA SYNC ---
  useEffect(() => {
    if (!user) return;

    // Listen to Config updates from Cloud
    const configRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'config');
    const unsubConfig = onSnapshot(configRef, (docSnap) => {
      if (docSnap.exists()) {
        setConfig(docSnap.data());
      }
      setDbSyncing(false);
    }, (err) => console.error("Config Sync Error:", err));

    // Listen to Actuals updates from Cloud
    const actualsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'actuals');
    const unsubActuals = onSnapshot(actualsRef, (docSnap) => {
      if (docSnap.exists()) {
        setActuals(docSnap.data());
      }
    }, (err) => console.error("Actuals Sync Error:", err));

    return () => { unsubConfig(); unsubActuals(); };
  }, [user]);

  // --- FIRESTORE SAVE HANDLERS ---
  const saveConfigToCloud = async (newConfig) => {
    setConfig(newConfig); // Optimistic UI update
    if (!user) return;
    try {
      const configRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'config');
      await setDoc(configRef, newConfig, { merge: true });
    } catch (err) {
      console.error("Failed to save config:", err);
    }
  };

  const saveActualToCloud = async (dayLabel, value) => {
    const newVal = { ...actuals, [dayLabel]: value };
    setActuals(newVal); // Optimistic UI update
    if (!user) return;
    try {
      const actualsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'actuals');
      await setDoc(actualsRef, { [dayLabel]: value }, { merge: true });
    } catch (err) {
      console.error("Failed to save actuals:", err);
    }
  };

  // --- DATA FETCHING ---
  useEffect(() => {
    if (dbSyncing) return; // Wait for initial DB sync before calculating physics

    const fetchSolarData = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${LATITUDE}&longitude=${LONGITUDE}&hourly=temperature_2m,direct_normal_irradiance,diffuse_radiation,cloudcover&timezone=GMT&forecast_days=7&past_days=7`
        );
        if (!response.ok) throw new Error("Failed to fetch weather data");
        const json = await response.json();
        const hourly = json.hourly;
        const processedData = [];
        const totalsByDay = {};
        const now = new Date();
        const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        let closestNowDiff = Infinity;
        let currentNowLabel = "";

        for (let i = 0; i < hourly.time.length; i++) {
          const timeStr = hourly.time[i];
          const date = new Date(timeStr + "Z");
          const temp = hourly.temperature_2m[i];
          const dni = hourly.direct_normal_irradiance[i];
          const dhi = hourly.diffuse_radiation[i];
          const solarPos = getSolarPosition(date, LATITUDE, LONGITUDE);

          const eastKw = calculateArrayPower(dni, dhi, temp, solarPos, 90, config.tilt, capacityEast, config.eff);
          const westKw = calculateArrayPower(dni, dhi, temp, solarPos, 270, config.tilt, capacityWest, config.eff);
          const totalKw = eastKw + westKw;

          const localTimeLabel = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const dayLabel = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
          const fullLabel = `${dayLabel} ${localTimeLabel}`;

          const diff = Math.abs(date - now);
          if (diff < closestNowDiff) {
            closestNowDiff = diff;
            currentNowLabel = fullLabel;
          }

          processedData.push({
            date: date,
            dayLabel: dayLabel,
            timeLabel: localTimeLabel,
            fullLabel: fullLabel,
            east: Number(eastKw.toFixed(2)),
            west: Number(westKw.toFixed(2)),
            total: Number(totalKw.toFixed(2)),
          });

          const itemMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
          const dayOffset = Math.round((itemMidnight - todayMidnight) / (1000 * 60 * 60 * 24));

          if (!totalsByDay[dayLabel]) {
            totalsByDay[dayLabel] = { date: itemMidnight, dayLabel, dayOffset, yield: 0, eastYield: 0, westYield: 0 };
          }
          totalsByDay[dayLabel].yield += totalKw;
          totalsByDay[dayLabel].eastYield += eastKw;
          totalsByDay[dayLabel].westYield += westKw;
        }

        setData(processedData);
        setNowLabel(currentNowLabel);

        const sortedTotals = Object.values(totalsByDay).sort((a, b) => a.date - b.date);
        setDailyTotals(sortedTotals);

        // Auto-select today's date for the hourly drill-down on initial load
        setSelectedDayLabel(prev => {
          if (!prev) {
            const today = sortedTotals.find(d => d.dayOffset === 0);
            return today ? today.dayLabel : sortedTotals[0]?.dayLabel;
          }
          return prev;
        });
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSolarData();
    const intervalId = setInterval(fetchSolarData, 5 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [config, capacityEast, capacityWest, dbSyncing]);

  // --- UI RENDERING ---
  if ((loading || dbSyncing) && data.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#1a1b23] text-white">
        <div className="text-center animate-pulse">
          <Sun className="w-12 h-12 mx-auto mb-4 text-[#fde047] animate-spin-slow" />
          <h2 className="text-xl font-semibold">Calculating Sun Position & Irradiance...</h2>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-2xl mx-auto mt-12 bg-red-900/20 border border-red-500/50 rounded-xl text-red-200">
        <AlertCircle className="w-8 h-8 mb-3 text-red-400" />
        <h2 className="text-xl font-bold mb-2">Error Loading Data</h2>
        <p>{error}</p>
      </div>
    );
  }

  const maxKw = Math.max(...data.map(d => d.total));
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

  // Calculate new efficiency (cap between 10% and 100%)
  let suggestedEff = config.eff;
  if (sumActuals > 0 && sumModel > 0) {
    suggestedEff = Math.min(1.0, Math.max(0.1, config.eff * (sumActuals / sumModel)));
  }

  const canApply = daysEntered > 0 && Math.abs(config.eff - suggestedEff) > 0.001;

  // Hourly Drill-down Data
  const selectedDayData = data.filter(d => d.dayLabel === selectedDayLabel);
  const selectedDaySummary = dailyTotals.find(d => d.dayLabel === selectedDayLabel);
  const currentHourTick = nowLabel && nowLabel.startsWith(selectedDayLabel) ? nowLabel.replace(selectedDayLabel + ' ', '') : null;

  return (
    <div className="min-h-screen bg-[#1a1b23] p-4 md:p-6 font-sans text-slate-200">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              Dynamic Solar Forecaster
              {user && !user.isAnonymous && <Cloud className="w-5 h-5 text-emerald-400 ml-2" title="Cloud Sync Active" />}
            </h1>
            <p className="text-slate-400 text-sm mt-1 flex items-center gap-1">
              <Info className="w-4 h-4" /> 53.3767°N, -6.3286°W • {user?.isAnonymous ? "Anonymous Mode" : "Secure Cloud Storage Active"}
            </p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="px-4 py-2 bg-[#252630] hover:bg-[#2d2e3a] border border-slate-700 text-slate-300 rounded-lg flex items-center gap-2 transition-colors text-sm font-medium shadow-sm"
            >
              <Settings className="w-4 h-4" /> Parameters
            </button>

            {user?.isAnonymous ? (
              <button
                onClick={handleLogin}
                className="flex-1 md:flex-none px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center justify-center gap-2 transition-colors text-sm font-medium shadow-md"
              >
                <LogIn className="w-4 h-4" /> Sign In
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-[#252630] p-1 pr-3 rounded-full border border-slate-700 shadow-sm">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-slate-600" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                    <User className="w-4 h-4 text-slate-400" />
                  </div>
                )}
                <button
                  onClick={handleLogout}
                  className="text-slate-400 hover:text-white transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* CONFIGURATION PANEL (All Inputs mapped to Cloud Sync) */}
        {showConfig && (
          <div className="bg-[#252630] p-5 rounded-xl border border-slate-700 shadow-lg animate-in fade-in slide-in-from-top-4">
            <h3 className="font-semibold text-white mb-4 text-sm flex items-center gap-2">
              <Calculator className="w-4 h-4 text-amber-400" /> Physical Array Settings
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Tilt Angle (°)</label>
                <input type="number" value={config.tilt} onChange={e => saveConfigToCloud({ ...config, tilt: Number(e.target.value) })}
                  className="w-full p-2.5 bg-[#1a1b23] border border-slate-600 rounded-lg text-white font-mono outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">System Efficiency (%)</label>
                <input type="number" value={config.eff * 100} onChange={e => saveConfigToCloud({ ...config, eff: Number(e.target.value) / 100 })}
                  className="w-full p-2.5 bg-[#1a1b23] border border-slate-600 rounded-lg text-white font-mono outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">East Panels</label>
                <input type="number" value={config.eastCount} onChange={e => saveConfigToCloud({ ...config, eastCount: Number(e.target.value) })}
                  className="w-full p-2.5 bg-[#1a1b23] border border-slate-600 rounded-lg text-white font-mono outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">West Panels</label>
                <input type="number" value={config.westCount} onChange={e => saveConfigToCloud({ ...config, westCount: Number(e.target.value) })}
                  className="w-full p-2.5 bg-[#1a1b23] border border-slate-600 rounded-lg text-white font-mono outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition-all" />
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-700/50 flex justify-between items-center text-xs text-slate-400">
              <p>Total Calculated Capacity: <strong className="text-white text-sm">{totalCapacity.toFixed(2)} kWp</strong></p>
              <p>Changes autosave to the cloud.</p>
            </div>
          </div>
        )}

        {/* DYNAMIC METRICS CALIBRATOR */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

          {/* Card 1: Today Model Output */}
          <div className="bg-[#252630] p-5 rounded-xl border border-slate-700/50 shadow-sm flex flex-col justify-between">
            <div>
              <p className="text-slate-400 text-sm font-medium mb-1">Model Forecast Today</p>
              <div className="flex items-end gap-2">
                <h2 className="text-3xl font-bold text-white">{todayForecast.yield.toFixed(1)}</h2>
                <span className="text-slate-500 mb-1 font-medium">kWh</span>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
              <Sun className="w-4 h-4 text-amber-400" /> E: {todayForecast.eastYield.toFixed(1)} / W: {todayForecast.westYield.toFixed(1)}
            </div>
          </div>

          {/* Card 2: User Input (Actuals) */}
          <div className="bg-gradient-to-br from-[#1e293b] to-[#0f172a] p-5 rounded-xl border border-indigo-500/30 shadow-sm flex flex-col justify-between">
            <div>
              <label className="text-indigo-300 text-sm font-medium mb-1 flex items-center gap-2">
                <Zap className="w-4 h-4" /> Today's Inverter Actual
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  value={actuals[todayForecast.dayLabel] || ''}
                  onChange={e => saveActualToCloud(todayForecast.dayLabel, e.target.value)}
                  className="w-full bg-[#1a1b23]/50 border-b-2 border-indigo-500 p-1 text-3xl font-bold text-white outline-none focus:border-indigo-400 transition-colors"
                  step="0.1"
                  placeholder="0.0"
                />
                <span className="text-slate-500 font-medium">kWh</span>
              </div>
            </div>
            <p className="mt-4 text-[11px] text-slate-500 leading-tight">
              Type what your app says today. Autosaves to cloud to maintain model tuning.
            </p>
          </div>

          {/* Card 3: Dynamic Auto-Calibration Output */}
          <div className={`p-5 rounded-xl border shadow-sm flex flex-col justify-between ${daysEntered > 0 ? (isAccurate ? 'bg-emerald-900/10 border-emerald-500/20' : 'bg-amber-900/10 border-amber-500/20') : 'bg-[#252630] border-slate-700/50'}`}>
            <div>
              <p className="text-slate-400 text-sm font-medium mb-1 flex items-center gap-2">
                <Target className="w-4 h-4" /> Model Calibration
              </p>
              {daysEntered > 0 ? (
                <div className="flex items-end gap-2 mt-2">
                  <h2 className={`text-3xl font-bold ${isAccurate ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {accuracyPercentage}% <span className="text-sm font-normal text-slate-400">accuracy</span>
                  </h2>
                </div>
              ) : (
                <p className="text-slate-500 text-sm mt-3">Enter actuals to calibrate.</p>
              )}
            </div>

            <div className="mt-3">
              {canApply ? (
                <button
                  onClick={() => saveConfigToCloud({ ...config, eff: suggestedEff })}
                  className={`w-full py-1.5 text-xs font-bold rounded border transition-colors ${isAccurate ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border-amber-500/30'}`}
                >
                  Apply {(suggestedEff * 100).toFixed(1)}% Efficiency
                </button>
              ) : daysEntered > 0 ? (
                <p className="text-[11px] text-emerald-500 font-medium leading-tight">
                  Model is perfectly tuned!
                </p>
              ) : null}
            </div>
          </div>

          {/* Card 4: Tomorrow Forecast Output */}
          <div className="bg-[#252630] p-5 rounded-xl border border-slate-700/50 shadow-sm flex flex-col justify-between">
            <div>
              <p className="text-slate-400 text-sm font-medium mb-1">Forecast Tomorrow</p>
              <div className="flex items-end gap-2">
                <h2 className="text-3xl font-bold text-white">{tomorrowForecast.yield.toFixed(1)}</h2>
                <span className="text-slate-500 mb-1 font-medium">kWh</span>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
              <Calendar className="w-4 h-4 text-blue-400" /> Open-Meteo predictions
            </div>
          </div>

        </div>

        {/* DYNAMIC CHART */}
        <div className="bg-[#252630] p-5 md:p-6 rounded-2xl border border-slate-700/50 shadow-lg">
          <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Dynamic Yield Curve (kW)</h2>
              <p className="text-xs text-slate-400">7 Days Past (Actual Weather) & 7 Days Future (Forecast) • <span className="text-indigo-400 font-semibold">Click chart to drill down</span></p>
            </div>
          </div>

          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data}
                margin={{ top: 10, right: 0, left: -20, bottom: 0 }}
                onClick={(state) => {
                  if (state && state.activePayload && state.activePayload.length > 0) {
                    setSelectedDayLabel(state.activePayload[0].payload.dayLabel);
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                <defs>
                  <linearGradient id="colorYellow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#fde047" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#fde047" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                <XAxis
                  dataKey="fullLabel"
                  tickFormatter={(val) => val.split(' ')[0]}
                  interval={23}
                  stroke="#64748b"
                  fontSize={11}
                  tickMargin={10}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  domain={[0, Math.ceil(maxKw)]}
                  axisLine={false}
                  tickLine={false}
                  tickMargin={10}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f8fafc' }}
                  itemStyle={{ color: '#fde047', fontWeight: 'bold' }}
                  labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Model Generation"
                  stroke="#fde047"
                  fill="url(#colorYellow)"
                  strokeWidth={2}
                />
                {nowLabel && (
                  <ReferenceLine
                    x={nowLabel}
                    stroke="#818cf8"
                    strokeDasharray="4 4"
                    label={{ position: 'insideTopLeft', value: 'CURRENT TIME', fill: '#818cf8', fontSize: 10, fontWeight: 600 }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* HOURLY DRILL DOWN CHART */}
        {selectedDayData.length > 0 && selectedDaySummary && (
          <div className="bg-[#252630] p-5 md:p-6 rounded-2xl border border-indigo-500/30 shadow-lg animate-in fade-in slide-in-from-top-4">
            <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-indigo-400" />
                  Hourly Profile: {selectedDayLabel}
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Total Yield: <span className="text-white font-medium">{selectedDaySummary.yield.toFixed(2)} kWh</span>
                  &nbsp;(East String: <span className="text-amber-400">{selectedDaySummary.eastYield.toFixed(2)}</span> | West String: <span className="text-red-400">{selectedDaySummary.westYield.toFixed(2)}</span>)
                </p>
              </div>
            </div>

            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={selectedDayData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#fde047" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#fde047" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                  <XAxis
                    dataKey="timeLabel"
                    interval={3}
                    stroke="#64748b"
                    fontSize={11}
                    tickMargin={10}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#64748b"
                    fontSize={11}
                    axisLine={false}
                    tickLine={false}
                    tickMargin={10}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f8fafc' }}
                    itemStyle={{ fontWeight: 'bold' }}
                    labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
                  />
                  <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#cbd5e1' }} />

                  <Area type="monotone" dataKey="total" name="Total Combined" stroke="#fde047" fill="url(#colorTotal)" strokeWidth={2} />
                  <Line type="monotone" dataKey="east" name="East (Morning)" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="west" name="West (Afternoon)" stroke="#ef4444" strokeWidth={2} dot={false} />

                  {currentHourTick && (
                    <ReferenceLine
                      x={currentHourTick}
                      stroke="#818cf8"
                      strokeDasharray="4 4"
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* DYNAMIC 14-DAY BREAKDOWN TABLE */}
        <div className="bg-[#252630] rounded-2xl border border-slate-700/50 overflow-hidden shadow-lg">
          <div className="p-5 border-b border-slate-700/50 flex justify-between items-center bg-[#1e293b]/50">
            <h2 className="text-lg font-semibold text-white">Daily Calculation Breakdown</h2>
            <span className="text-xs text-slate-400 bg-slate-800 px-2 py-1 rounded">Values in kWh</span>
          </div>
          <div className="overflow-x-auto max-h-[350px] overflow-y-auto custom-scrollbar">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="sticky top-0 bg-[#252630] z-10 shadow-sm border-b border-slate-700">
                <tr className="text-slate-400 uppercase tracking-wider text-[11px] font-semibold">
                  <th className="p-4">Date</th>
                  <th className="p-4">Timeframe</th>
                  <th className="p-4">East String</th>
                  <th className="p-4">West String</th>
                  <th className="p-4 text-indigo-300">Actual (Input)</th>
                  <th className="p-4 text-white">Total Model</th>
                </tr>
              </thead>
              <tbody className="text-slate-300 divide-y divide-slate-700/50">
                {dailyTotals.map((day, i) => {
                  const isToday = day.dayOffset === 0;
                  const isSelected = selectedDayLabel === day.dayLabel;
                  return (
                    <tr
                      key={i}
                      onClick={() => setSelectedDayLabel(day.dayLabel)}
                      className={`hover:bg-[#2d2e3a] transition-colors cursor-pointer ${isSelected ? 'bg-indigo-900/40 border-l-2 border-indigo-400' : isToday ? 'bg-indigo-900/10' : ''
                        }`}
                    >
                      <td className="p-4 font-medium">
                        {day.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="p-4">
                        {day.dayOffset < 0 ? (
                          <span className="text-[10px] font-semibold px-2 py-1 rounded bg-slate-800 text-slate-400">PAST WEATHER</span>
                        ) : isToday ? (
                          <span className="text-[10px] font-semibold px-2 py-1 rounded bg-indigo-500/20 text-indigo-400">TODAY</span>
                        ) : (
                          <span className="text-[10px] font-semibold px-2 py-1 rounded bg-amber-500/10 text-amber-400">FORECAST</span>
                        )}
                      </td>
                      <td className="p-4 text-slate-400 font-mono">{day.eastYield.toFixed(1)}</td>
                      <td className="p-4 text-slate-400 font-mono">{day.westYield.toFixed(1)}</td>
                      <td className="p-4" onClick={(e) => e.stopPropagation()}>
                        {day.dayOffset <= 0 ? (
                          <input
                            type="number"
                            value={actuals[day.dayLabel] || ''}
                            onChange={(e) => saveActualToCloud(day.dayLabel, e.target.value)}
                            className="w-20 bg-[#1a1b23] border border-slate-600 rounded px-2 py-1 text-white text-sm focus:border-indigo-500 outline-none font-mono"
                            placeholder="---"
                            step="0.1"
                          />
                        ) : (
                          <span className="text-slate-600 pl-4">---</span>
                        )}
                      </td>
                      <td className="p-4 font-bold text-white font-mono">{day.yield.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}