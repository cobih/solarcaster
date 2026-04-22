import React, { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  ComposedChart, Line, Legend
} from 'recharts';
import {
  Sun, Calendar, Settings, AlertCircle, Info, Target, Calculator, Zap, Cloud,
  LogOut, LogIn, User, Plus, Trash2
} from 'lucide-react';

import { useSolarAuth } from './hooks/useSolarAuth';
import { useFirestoreSync } from './hooks/useFirestoreSync';
import { useSolarPhysics } from './hooks/useSolarPhysics';

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

  // Selected Day Drill-down
  useEffect(() => {
    if (!selectedDayLabel && dailyTotals.length > 0) {
      const today = dailyTotals.find(d => d.dayOffset === 0);
      setSelectedDayLabel(today ? today.dayLabel : dailyTotals[0].dayLabel);
    }
  }, [dailyTotals, selectedDayLabel]);

  const selectedDayData = data.filter(d => d.dayLabel === selectedDayLabel);
  const selectedDaySummary = dailyTotals.find(d => d.dayLabel === selectedDayLabel);
  const currentHourTick = nowLabel && nowLabel.startsWith(selectedDayLabel) ? nowLabel.replace(selectedDayLabel + ' ', '') : null;

  // String Colors for Charts
  const STRING_COLORS = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

  // --- STRING MANAGEMENT ---
  const addString = () => {
    const newString = {
      id: 's' + Date.now(),
      name: `String ${config.strings.length + 1}`,
      azimuth: 180,
      tilt: 35,
      count: 10
    };
    saveConfigToCloud({ ...config, strings: [...config.strings, newString] });
  };

  const removeString = (id) => {
    if (config.strings.length <= 1) return; // Keep at least one
    saveConfigToCloud({ ...config, strings: config.strings.filter(s => s.id !== id) });
  };

  const updateString = (id, field, value) => {
    const updated = config.strings.map(s => s.id === id ? { ...s, [field]: value } : s);
    saveConfigToCloud({ ...config, strings: updated });
  };

  // --- UI RENDERING ---

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#1a1b23] text-white">
        <div className="text-center">
          <Sun className="w-12 h-12 mx-auto mb-4 text-indigo-500 animate-spin-slow" />
          <h2 className="text-xl font-semibold">Checking Authentication...</h2>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#1a1b23] p-6">
        <div className="max-w-md w-full bg-[#252630] p-8 rounded-2xl border border-slate-700 shadow-2xl text-center">
          <div className="w-20 h-20 bg-indigo-600/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <Sun className="w-10 h-10 text-indigo-500" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">Solarcaster</h1>
          <p className="text-slate-400 mb-8 leading-relaxed">
            Dynamic solar forecasting with cloud persistence and model auto-calibration.
          </p>
          <button onClick={login} className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center justify-center gap-3 transition-all font-bold text-lg shadow-lg">
            <LogIn className="w-6 h-6" /> Sign in with Google
          </button>
        </div>
      </div>
    );
  }

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

  return (
    <div className="min-h-screen bg-[#1a1b23] p-4 md:p-6 font-sans text-slate-200">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              Dynamic Solar Forecaster
              <Cloud className="w-5 h-5 text-emerald-400 ml-2" title="Cloud Sync Active" />
            </h1>
            <p className="text-slate-400 text-sm mt-1 flex items-center gap-1">
              <Info className="w-4 h-4" /> 53.3767°N, -6.3286°W • Connected as {user.email}
            </p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <button onClick={() => setShowConfig(!showConfig)} className="px-4 py-2 bg-[#252630] hover:bg-[#2d2e3a] border border-slate-700 text-slate-300 rounded-lg flex items-center gap-2 transition-colors text-sm font-medium shadow-sm">
              <Settings className="w-4 h-4" /> Parameters
            </button>
            <div className="flex items-center gap-2 bg-[#252630] p-1 pr-3 rounded-full border border-slate-700 shadow-sm">
              {user.photoURL ? (
                <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-slate-600" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center"><User className="w-4 h-4 text-slate-400" /></div>
              )}
              <button onClick={logout} className="text-slate-400 hover:text-white transition-colors"><LogOut className="w-4 h-4" /></button>
            </div>
          </div>
        </div>

        {/* CONFIG PANEL */}
        {showConfig && (
          <div className="bg-[#252630] p-5 rounded-xl border border-slate-700 shadow-lg animate-in fade-in slide-in-from-top-4 space-y-6">
            <div className="flex justify-between items-center border-b border-slate-700 pb-4">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2"><Calculator className="w-4 h-4 text-amber-400" /> System Configuration</h3>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                   <label className="text-[10px] text-slate-400 uppercase font-bold">System Efficiency</label>
                   <input type="number" value={config.eff * 100} onChange={e => saveConfigToCloud({ ...config, eff: Number(e.target.value) / 100 })}
                    className="w-16 p-1 bg-[#1a1b23] border border-slate-600 rounded text-white text-xs font-mono" />
                   <span className="text-xs text-slate-500">%</span>
                </div>
                <button onClick={addString} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-bold flex items-center gap-1 transition-colors">
                  <Plus className="w-3 h-3" /> Add String
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(config.strings || []).map((s, idx) => (
                <div key={s.id} className="p-4 bg-[#1a1b23] rounded-lg border border-slate-700 relative group">
                  <button onClick={() => removeString(s.id)} className="absolute top-2 right-2 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">String Name</label>
                      <input type="text" value={s.name} onChange={e => updateString(s.id, 'name', e.target.value)}
                        className="w-full bg-transparent border-b border-slate-700 focus:border-indigo-500 outline-none text-sm text-white py-1" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Panels (465W)</label>
                      <input type="number" value={s.count} onChange={e => updateString(s.id, 'count', Number(e.target.value))}
                        className="w-full bg-[#252630] border border-slate-700 rounded px-2 py-1 text-sm text-white outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Azimuth (°)</label>
                      <input type="number" value={s.azimuth} onChange={e => updateString(s.id, 'azimuth', Number(e.target.value))}
                        className="w-full bg-[#252630] border border-slate-700 rounded px-2 py-1 text-sm text-white outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Tilt (°)</label>
                      <input type="number" value={s.tilt} onChange={e => updateString(s.id, 'tilt', Number(e.target.value))}
                        className="w-full bg-[#252630] border border-slate-700 rounded px-2 py-1 text-sm text-white outline-none focus:border-indigo-500" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-slate-700/50 flex justify-between items-center text-xs text-slate-400">
              <p>Total Capacity: <strong className="text-white text-sm">{totalCapacity.toFixed(2)} kWp</strong></p>
              <p>Autosaves to cloud.</p>
            </div>
          </div>
        )}

        {/* METRICS */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Card 1: Today Model Output */}
          <div className="bg-[#252630] p-5 rounded-xl border border-slate-700/50 shadow-sm flex flex-col justify-between">
          <div>
            <p className="text-slate-400 text-sm font-medium mb-1">Model Forecast Today</p>
            <div className="flex items-end gap-2"><h2 className="text-3xl font-bold text-white">{todayForecast.yield.toFixed(1)}</h2><span className="text-slate-500 mb-1 font-medium">kWh</span></div>
          </div>
          <div className="mt-4 space-y-1">
            {(config.strings || []).map((s, idx) => (
              <div key={s.id} className="flex items-center gap-2 text-[10px] text-slate-500">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STRING_COLORS[idx % STRING_COLORS.length] }}></div>
                <span className="truncate flex-1">{s.name}:</span>
                <span className="font-mono text-slate-400">{(todayForecast.strings?.[s.id] || 0).toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
          <div className="bg-gradient-to-br from-[#1e293b] to-[#0f172a] p-5 rounded-xl border border-indigo-500/30 shadow-sm flex flex-col justify-between">
            <div>
              <label className="text-indigo-300 text-sm font-medium mb-1 flex items-center gap-2"><Zap className="w-4 h-4" /> Today's Inverter Actual</label>
              <div className="mt-2 flex items-center gap-2">
                <input type="number" value={actuals[todayForecast.dayLabel] || ''} onChange={e => saveActualToCloud(todayForecast.dayLabel, e.target.value)}
                  className="w-full bg-[#1a1b23]/50 border-b-2 border-indigo-500 p-1 text-3xl font-bold text-white outline-none focus:border-indigo-400 transition-colors" step="0.1" placeholder="0.0" />
                <span className="text-slate-500 font-medium">kWh</span>
              </div>
            </div>
            <p className="mt-4 text-[11px] text-slate-500 leading-tight">Type what your app says today. Autosaves to cloud.</p>
          </div>

          <div className={`p-5 rounded-xl border shadow-sm flex flex-col justify-between ${daysEntered > 0 ? (isAccurate ? 'bg-emerald-900/10 border-emerald-500/20' : 'bg-amber-900/10 border-amber-500/20') : 'bg-[#252630] border-slate-700/50'}`}>
            <div>
              <p className="text-slate-400 text-sm font-medium mb-1 flex items-center gap-2"><Target className="w-4 h-4" /> Model Calibration</p>
              {daysEntered > 0 ? (
                <div className="flex items-end gap-2 mt-2"><h2 className={`text-3xl font-bold ${isAccurate ? 'text-emerald-400' : 'text-amber-400'}`}>{accuracyPercentage}% <span className="text-sm font-normal text-slate-400">accuracy</span></h2></div>
              ) : <p className="text-slate-500 text-sm mt-3">Enter actuals to calibrate.</p>}
            </div>
            <div className="mt-3">
              {canApply ? (
                <div className="space-y-2">
                  <p className="text-[10px] text-amber-500 font-medium animate-pulse">Calibration Recommended</p>
                  <button onClick={() => saveConfigToCloud({ ...config, eff: suggestedEff })}
                    className={`w-full py-1.5 text-xs font-bold rounded border transition-colors ${isAccurate ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border-amber-500/30'}`}>
                    Apply {(suggestedEff * 100).toFixed(1)}% Efficiency
                  </button>
                </div>
              ) : daysEntered > 0 ? <p className="text-[11px] text-emerald-500 font-medium leading-tight">Model is perfectly tuned!</p> : null}
            </div>
          </div>

          <div className="bg-[#252630] p-5 rounded-xl border border-slate-700/50 shadow-sm flex flex-col justify-between">
            <div>
              <p className="text-slate-400 text-sm font-medium mb-1">Forecast Tomorrow</p>
              <div className="flex items-end gap-2"><h2 className="text-3xl font-bold text-white">{tomorrowForecast.yield.toFixed(1)}</h2><span className="text-slate-500 mb-1 font-medium">kWh</span></div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-slate-400"><Calendar className="w-4 h-4 text-blue-400" /> Open-Meteo predictions</div>
          </div>
        </div>

        {/* MAIN CHART */}
        <div className="bg-[#252630] p-5 md:p-6 rounded-2xl border border-slate-700/50 shadow-lg">
          <h2 className="text-lg font-semibold text-white mb-6">Dynamic Yield Curve (kW)</h2>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }} onClick={(state) => state?.activePayload?.[0] && setSelectedDayLabel(state.activePayload[0].payload.dayLabel)} style={{ cursor: 'pointer' }}>
                <defs>
                  <linearGradient id="colorYellow" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#fde047" stopOpacity={0.4} /><stop offset="95%" stopColor="#fde047" stopOpacity={0.0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                <XAxis dataKey="fullLabel" tickFormatter={(val) => val.split(' ')[0]} interval={23} stroke="#64748b" fontSize={11} tickMargin={10} axisLine={false} tickLine={false} />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  domain={[0, Math.ceil(maxKw)]}
                  axisLine={false}
                  tickLine={false}
                  tickMargin={10}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#475569"
                  fontSize={10}
                  domain={[0, 100]}
                  axisLine={false}
                  tickLine={false}
                  unit="%"
                  hide={true} // Keep it subtle, just use the data
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f8fafc' }}
                  itemStyle={{ color: '#fde047', fontWeight: 'bold' }}
                  labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="cloudCover"
                  name="Cloud Cover"
                  stroke="none"
                  fill="#475569"
                  fillOpacity={0.15}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Model Generation"
                  stroke="#fde047"
                  fill="url(#colorYellow)"
                  strokeWidth={2}
                />
                {nowLabel && <ReferenceLine x={nowLabel} stroke="#818cf8" strokeDasharray="4 4" label={{ position: 'insideTopLeft', value: 'CURRENT TIME', fill: '#818cf8', fontSize: 10, fontWeight: 600 }} />}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* DRILL DOWN */}
        {selectedDayData.length > 0 && selectedDaySummary && (
          <div className="bg-[#252630] p-5 md:p-6 rounded-2xl border border-indigo-500/30 shadow-lg">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-6"><Calendar className="w-5 h-5 text-indigo-400" /> Hourly Profile: {selectedDayLabel}</h2>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={selectedDayData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                  <XAxis dataKey="timeLabel" interval={3} stroke="#64748b" fontSize={11} tickMargin={10} axisLine={false} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} axisLine={false} tickLine={false} tickMargin={10} />
                  <YAxis yAxisId="right" orientation="right" stroke="#818cf8" fontSize={10} axisLine={false} tickLine={false} tickMargin={10} unit="kWh" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f8fafc' }} 
                    itemStyle={{ fontWeight: 'bold' }} 
                    labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
                    formatter={(value, name) => {
                      if (name === "Energy (Cumulative)") {
                        return [`${value} kWh`, name];
                      }
                      if (name === "Cloud Cover (%)") return [`${value}%`, name];
                      return [`${value} kW`, name];
                    }}
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-[#1e293b] border border-slate-700 p-3 rounded-lg shadow-xl text-xs space-y-2">
                            <p className="font-bold text-slate-400 mb-1">{label}</p>
                            <div className="space-y-1">
                              {payload.map((entry, idx) => {
                                // Only show total and cumulative with high prominence
                                const isTotal = entry.dataKey === 'total';
                                const isCum = entry.dataKey === 'cumulativeYield';
                                return (
                                  <div key={idx} className={`flex items-center justify-between gap-4 ${isTotal || isCum ? 'pt-1 border-t border-slate-800 font-bold' : ''}`}>
                                    <div className="flex items-center gap-2">
                                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></div>
                                      <span className="text-slate-300">{entry.name}:</span>
                                    </div>
                                    <span className="text-white font-mono">{entry.value} {entry.dataKey === 'cumulativeYield' ? 'kWh' : 'kW'}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#cbd5e1' }} />
                  
                  {/* Invisible Cloud Cover to use its data for overlay */}
                  <Area yAxisId="right" type="monotone" dataKey="cloudCover" name="Cloud Cover (%)" stroke="none" fill="#475569" fillOpacity={0.1} hide={false} />
                  
                  {/* Power Generation (Spot) */}
                  <Area type="monotone" dataKey="total" name="Total Power (kW)" stroke="#fde047" fill="#fde047" fillOpacity={0.1} strokeWidth={2} />
                  
                  {/* Dynamic Individual String Curves */}
                  {(config.strings || []).map((s, idx) => (
                    <Line 
                      key={s.id}
                      type="monotone" 
                      dataKey={`stringPowers.${s.id}`} 
                      name={`${s.name} (kW)`} 
                      stroke={STRING_COLORS[idx % STRING_COLORS.length]} 
                      strokeWidth={1.5} 
                      dot={false} 
                      strokeDasharray="5 5" 
                    />
                  ))}

                  {/* Cumulative Yield (The goal) */}
                  <Line 
                    yAxisId="right"
                    type="monotone" 
                    dataKey="cumulativeYield" 
                    name="Energy (Cumulative)" 
                    stroke="#818cf8" 
                    strokeWidth={3} 
                    dot={false} 
                  />

                  {currentHourTick && <ReferenceLine x={currentHourTick} stroke="#818cf8" strokeDasharray="4 4" />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* TABLE */}
        <div className="bg-[#252630] rounded-2xl border border-slate-700/50 overflow-hidden shadow-lg">
          <div className="p-5 border-b border-slate-700/50 flex justify-between items-center bg-[#1e293b]/50">
            <h2 className="text-lg font-semibold text-white">Daily Calculation Breakdown</h2>
          </div>
          <div className="overflow-x-auto max-h-[450px] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[#252630] z-10 border-b border-slate-700">
                <tr className="text-slate-400 uppercase text-[11px] font-semibold">
                  <th className="p-4">Date</th>
                  <th className="p-4">Timeframe</th>
                  {(config.strings || []).map(s => (
                    <th key={s.id} className="p-4">{s.name}</th>
                  ))}
                  <th className="p-4 text-white">Model (kWh)</th>
                  <th className="p-4 text-indigo-300">Actual (kWh)</th>
                </tr>
              </thead>
              <tbody className="text-slate-300 divide-y divide-slate-700/50">
                {dailyTotals.map((day, i) => (
                  <tr key={i} onClick={() => setSelectedDayLabel(day.dayLabel)} className={`hover:bg-[#2d2e3a] cursor-pointer ${selectedDayLabel === day.dayLabel ? 'bg-indigo-900/40 border-l-2 border-indigo-400' : ''}`}>
                    <td className="p-4">{day.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    <td className="p-4">
                      {day.dayOffset < 0 ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-500">PAST</span>
                      ) : day.dayOffset === 0 ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400">TODAY</span>
                      ) : (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500">FCST</span>
                      )}
                    </td>
                    {(config.strings || []).map(s => (
                      <td key={s.id} className="p-4 text-slate-500 font-mono text-xs">{(day.strings?.[s.id] || 0).toFixed(1)}</td>
                    ))}
                    <td className="p-4 font-bold text-white">{(day.yield || 0).toFixed(2)}</td>
                    <td className="p-4" onClick={e => e.stopPropagation()}>
                      {day.dayOffset <= 0 ? (
                        <input type="number" value={actuals[day.dayLabel] || ''} onChange={e => saveActualToCloud(day.dayLabel, e.target.value)}
                          className="w-20 bg-[#1a1b23] border border-slate-600 rounded px-2 py-1 text-white text-xs outline-none focus:border-indigo-500" placeholder="---" />
                      ) : <span className="text-slate-700">---</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* DEBUG INFO */}
        <div className="mt-12 p-4 bg-slate-900/50 rounded-lg border border-slate-800 text-[10px] font-mono text-slate-500 overflow-x-auto">
          <div className="flex justify-between items-start mb-2 border-b border-slate-800 pb-2">
            <p className="font-bold text-slate-400">DEBUG SESSION INFO</p>
            <button onClick={() => { localStorage.clear(); window.location.href = "/"; }} className="text-indigo-400 underline">Reset Cache</button>
          </div>
          <p>UID: {user?.uid || "None"}</p>
          <p>Email: {user?.email || "None"}</p>
          <p>Error: <span className="text-red-400">{authError || "None"}</span></p>
          <p>DB Status: {dbStatus} | Sync: {lastSynced || "Never"}</p>
          <p>Path: /artifacts/{appId}/users/{user?.uid}/solar_app/</p>
        </div>

      </div>
    </div>
  );
}
