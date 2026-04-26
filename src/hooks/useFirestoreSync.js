import { useState, useEffect, useCallback } from 'react';
import { doc, setDoc, onSnapshot, collection, getDoc, query } from 'firebase/firestore';
import { db } from '../firebase';
import { sanitizeConfig } from '../utils/sanitize';

const DEMO_CONFIG = {
  lat: 53.3238,
  long: -6.3284,
  eff: 0.80,
  schemaVersion: 2,
  locationSet: true,
  arraysSet: true,
  locationName: 'Dublin 15, Ireland',
  strings: [
    { id: 'east', name: 'East String', count: 11, wattage: 465, azimuth: 90, tilt: 35 },
    { id: 'west', name: 'West String', count: 9, wattage: 465, azimuth: 270, tilt: 35 }
  ],
  effHistory: [],
  apiEnabled: false,
  excludedDays: [],
  acknowledgedOutliers: [],
  dailyConsumption: 12,
  batteryCapacity: 0,
  inverterACRating: null,
  onMicrogenScheme: true,
  exportRate: 0.21,
  importRate: 0.40,
  currency: "€",
  showEconomics: true, 
};

export const useFirestoreSync = (user, appId) => {
  const isDemo = user?.uid === 'demo-user';
  
  const [systems, setSystems] = useState(isDemo ? [{ id: 'demo', locationName: 'Dublin 15 (Demo)' }] : []);
  const [currentSystemId, setCurrentSystemId] = useState(isDemo ? 'demo' : 'default');
  const [dbSyncing, setDbSyncing] = useState(false);
  const [dbStatus, setDbStatus] = useState(isDemo ? "Demo Mode" : "Idle");
  const [lastSynced, setLastSynced] = useState(null);

  const [config, setConfig] = useState(isDemo ? DEMO_CONFIG : {
    lat: null, long: null, eff: 0.85, schemaVersion: 2,
    locationSet: false, arraysSet: false, locationName: "",
    strings: [], effHistory: [], apiEnabled: false,
    excludedDays: [], acknowledgedOutliers: [],
    dailyConsumption: 12, batteryCapacity: 0, inverterACRating: null,
    onMicrogenScheme: false, exportRate: 0.21, importRate: 0.40,
    currency: "€", showEconomics: false,
  });

  const [actuals, setActuals] = useState(isDemo ? { "2026-04-26": 24.5, "2026-04-25": 18.2 } : {});
  const [actualsData, setActualsData] = useState(isDemo ? {
    "2026-04-26": { value: 24.5, source: 'manual' },
    "2026-04-25": { value: 18.2, source: 'manual' }
  } : {});

  const [snapshots, setSnapshots] = useState({});
  const [sigenergy, setSigenergy] = useState(null);

  const [legacyActuals, setLegacyActuals] = useState({});
  const [newHistory, setNewHistory] = useState({});

  useEffect(() => {
    if (!user || isDemo) return;
    const systemsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'systems');
    const unsubSystems = onSnapshot(systemsRef, async (snap) => {
      try {
        if (snap.empty) {
          const legacyRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'config');
          const legacySnap = await getDoc(legacyRef);
          if (legacySnap.exists()) {
            const legacyData = legacySnap.data();
            const defaultSystemRef = doc(db, 'artifacts', appId, 'users', user.uid, 'systems', 'default');
            await setDoc(defaultSystemRef, { id: 'default', locationName: legacyData.locationName || "My Home", createdAt: new Date().toISOString() });
            const legacyActualsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'actuals');
            const legacySnapshotsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'snapshots');
            const actualsSnap = await getDoc(legacyActualsRef);
            const snapshotsSnap = await getDoc(legacySnapshotsRef);
            await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'systems', 'default', 'solar_app', 'config'), legacyData);
            if (actualsSnap.exists()) await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'systems', 'default', 'solar_app', 'actuals'), actualsSnap.data());
            if (snapshotsSnap.exists()) await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'systems', 'default', 'solar_app', 'snapshots'), snapshotsSnap.data());
            setSystems([{ id: 'default', locationName: legacyData.locationName || "My Home" }]);
          } else {
            const defaultSystemRef = doc(db, 'artifacts', appId, 'users', user.uid, 'systems', 'default');
            await setDoc(defaultSystemRef, { id: 'default', locationName: "My Home", createdAt: new Date().toISOString() });
            setSystems([{ id: 'default', locationName: "My Home" }]);
          }
        } else {
          setSystems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }
      } catch (err) { console.error(err); setSystems([{ id: 'default', locationName: "My Home" }]); }
    });
    return () => unsubSystems();
  }, [user, appId, isDemo]);

  useEffect(() => {
    if (!user || isDemo || !currentSystemId) return;
    setDbSyncing(true); setDbStatus("Connecting...");
    const timeoutId = setTimeout(() => setDbSyncing(false), 5000);
    const basePath = ['artifacts', appId, 'users', user.uid, 'systems', currentSystemId, 'solar_app'];
    
    const unsubConfig = onSnapshot(doc(db, ...basePath, 'config'), (docSnap) => {
      clearTimeout(timeoutId);
      if (docSnap.exists()) {
        const data = docSnap.data();
        const migrated = { ...data };
        if (data.lat !== undefined && data.long !== undefined) migrated.locationSet = true;
        if (!data.effHistory) migrated.effHistory = [];
        if (data.apiEnabled === undefined) migrated.apiEnabled = false;
        if (!data.excludedDays) migrated.excludedDays = [];
        if (!data.acknowledgedOutliers) migrated.acknowledgedOutliers = [];
        if (data.dailyConsumption === undefined) migrated.dailyConsumption = 12;
        if (data.batteryCapacity === undefined) migrated.batteryCapacity = 0;
        if (data.inverterACRating === undefined) migrated.inverterACRating = null;
        if (data.onMicrogenScheme === undefined) migrated.onMicrogenScheme = false;
        if (data.exportRate === undefined) migrated.exportRate = 0.21;
        if (data.importRate === undefined) migrated.importRate = 0.40;
        if (data.currency === undefined) migrated.currency = "€";
        if (data.strings && data.strings.length > 0) { migrated.arraysSet = true; migrated.strings = data.strings.map(s => ({ ...s, wattage: s.wattage || 465 })); }
        setConfig(migrated);
      } else {
        setConfig({
          lat: null, long: null, eff: 0.85, schemaVersion: 2, locationSet: false, arraysSet: false, locationName: "",
          strings: [], effHistory: [], apiEnabled: false, excludedDays: [], acknowledgedOutliers: [],
          dailyConsumption: 12, batteryCapacity: 0, inverterACRating: null, onMicrogenScheme: false, exportRate: 0.21, importRate: 0.40,
          currency: "€", showEconomics: false
        });
      }
      setDbSyncing(false); setDbStatus("Connected");
    });

    const unsubSnapshots = onSnapshot(doc(db, ...basePath, 'snapshots'), (docSnap) => { setSnapshots(docSnap.exists() ? docSnap.data() : {}); });

    const unsubLegacyActuals = onSnapshot(doc(db, ...basePath, 'actuals'), (docSnap) => {
      const data = docSnap.exists() ? docSnap.data() : {};
      const formatted = {};
      Object.keys(data).forEach(k => { formatted[k] = { value: data[k], source: 'manual' }; });
      setLegacyActuals(formatted);
    });

    const unsubHistory = onSnapshot(collection(db, ...basePath, 'history', 'daily'), (snap) => {
      const hist = {};
      snap.docs.forEach(d => { hist[d.id] = { value: d.data().actual_kwh, source: d.data().source || 'manual' }; });
      setNewHistory(hist);
    });

    const unsubSigen = onSnapshot(doc(db, 'users', user.uid, 'integrations', 'sigenergy'), (snap) => { setSigenergy(snap.exists() ? snap.data() : null); });

    return () => { unsubConfig(); unsubSnapshots(); unsubLegacyActuals(); unsubHistory(); unsubSigen(); clearTimeout(timeoutId); };
  }, [user, appId, isDemo, currentSystemId]);

  useEffect(() => {
    if (!isDemo) {
      const combined = { ...legacyActuals, ...newHistory };
      const simpleActuals = {};
      Object.keys(combined).forEach(k => { simpleActuals[k] = combined[k].value; });
      setActuals(simpleActuals);
      setActualsData(combined);
    }
  }, [legacyActuals, newHistory, isDemo]);

  const saveConfigToCloud = async (newConfig) => {
    const cleanConfig = sanitizeConfig(newConfig);
    if (newConfig.eff !== config.eff) {
      const entry = { val: newConfig.eff, date: new Date().toISOString(), label: new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }) };
      cleanConfig.effHistory = [entry, ...(config.effHistory || [])].slice(0, 50);
    }
    setConfig(cleanConfig); if (!user || isDemo || !currentSystemId) return;
    setDbStatus("Saving...");
    try {
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'systems', currentSystemId, 'solar_app', 'config'), cleanConfig, { merge: true });
      if (newConfig.locationName && newConfig.locationName !== config.locationName) await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'systems', currentSystemId), { locationName: newConfig.locationName }, { merge: true });
      setDbStatus("Saved"); setLastSynced(new Date().toLocaleTimeString());
    } catch (err) { setDbStatus("Save Error"); }
  };

  const saveActualToCloud = async (dayLabel, value) => {
    setActuals(prev => ({ ...prev, [dayLabel]: value }));
    setActualsData(prev => ({ ...prev, [dayLabel]: { value, source: 'manual' } }));
    if (!user || isDemo || !currentSystemId) return;
    setDbStatus(`Saving...`);
    try {
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'systems', currentSystemId, 'solar_app', 'actuals'), { [dayLabel]: value }, { merge: true });
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'systems', currentSystemId, 'solar_app', 'history', 'daily', dayLabel), { 
        actual_kwh: Number(value), source: "manual", timestamp: new Date().toISOString(), calibration_excluded: (config.excludedDays || []).includes(dayLabel)
      }, { merge: true });
      setDbStatus("Saved"); setLastSynced(new Date().toLocaleTimeString());
    } catch (err) { setDbStatus("Save Error"); }
  };

  const saveSnapshotToCloud = async (isoDate, modelledYield) => {
    setSnapshots(prev => ({ ...prev, [isoDate]: modelledYield }));
    if (!user || isDemo || !currentSystemId) return;
    try { await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'systems', currentSystemId, 'solar_app', 'snapshots'), { [isoDate]: modelledYield }, { merge: true }); } catch (err) { console.error(err); }
  };

  const addNewSystem = async (name) => {
    if (!user || isDemo) return;
    const newId = 'sys_' + Date.now();
    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'systems', newId), { id: newId, locationName: name, createdAt: new Date().toISOString() });
    setCurrentSystemId(newId); return newId;
  };

  const deleteSystem = async (systemId) => {
    if (!user || isDemo || systems.length <= 1) return;
    try { const { deleteDoc } = await import('firebase/firestore'); await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'systems', systemId)); if (systemId === currentSystemId) { const remaining = systems.filter(s => s.id !== systemId); if (remaining.length > 0) setCurrentSystemId(remaining[0].id); } } catch (err) { console.error(err); }
  };

  const disconnectSystem = async () => {
    if (!user || isDemo) return;
    const { deleteDoc } = await import('firebase/firestore'); await deleteDoc(doc(db, 'users', user.uid, 'integrations', 'sigenergy'));
  };

  const publishForecast = async (dailyTotals, hourlyData) => {
    if (!user || !config.apiEnabled || isDemo) return;
    try {
      const summary = dailyTotals.map(d => ({ day: d.dayLabel, yield: Number(d.yield.toFixed(2)), offset: d.dayOffset }));
      const hourly = (hourlyData || []).map(h => ({ time: h.date.toISOString(), kw: h.p50, p10: h.p10, p50: h.p50, p90: h.p90 }));
      await setDoc(doc(db, 'public_forecasts', user.uid), { lastUpdate: new Date().toISOString(), forecast: summary, hourly, unit: "kWh", note: "Use p50 for most likely prediction. kw is deprecated and will be removed in v2." });
    } catch (e) { console.error(e); }
  };

  return { 
    config, actuals, actualsData, snapshots, systems, sigenergy, currentSystemId, setCurrentSystemId,
    dbSyncing, dbStatus, lastSynced, saveConfigToCloud, saveActualToCloud,
    saveSnapshotToCloud, addNewSystem, deleteSystem, disconnectSystem, publishForecast
  };
};
