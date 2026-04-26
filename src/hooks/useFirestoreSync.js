import { useState, useEffect, useCallback } from 'react';
import { doc, setDoc, onSnapshot, collection, getDoc } from 'firebase/firestore';
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
    lat: null,
    long: null,
    eff: 0.85,
    schemaVersion: 2,
    locationSet: false,
    arraysSet: false,
    locationName: "",
    strings: [],
    effHistory: [],
    apiEnabled: false,
    excludedDays: [],
    acknowledgedOutliers: [],
    dailyConsumption: 12,
    batteryCapacity: 0,
    inverterACRating: null,
    onMicrogenScheme: false,
    exportRate: 0.21,
    importRate: 0.40,
    currency: "€",
    showEconomics: false,
  });

  const [actuals, setActuals] = useState(isDemo ? {
    "2026-04-26": 24.5,
    "2026-04-25": 18.2
  } : {});

  const [snapshots, setSnapshots] = useState({});
  const [sigenergy, setSigenergy] = useState(null);

  // --- 1. SYSTEM DISCOVERY & MIGRATION ---
  useEffect(() => {
    if (!user || isDemo) return;

    const systemsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'systems');
    const unsubSystems = onSnapshot(systemsRef, async (snap) => {
      try {
        if (snap.empty) {
          // Check for legacy data
          const legacyRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'config');
          const legacySnap = await getDoc(legacyRef);
          
          if (legacySnap.exists()) {
            // MIGRATE: Copy legacy data to default system
            const legacyData = legacySnap.data();
            const defaultSystemRef = doc(db, 'artifacts', appId, 'users', user.uid, 'systems', 'default');
            
            await setDoc(defaultSystemRef, { 
              id: 'default', 
              locationName: legacyData.locationName || "My Home",
              createdAt: new Date().toISOString()
            });
            
            // Move documents
            const legacyActualsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'actuals');
            const legacySnapshotsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'snapshots');
            
            const actualsSnap = await getDoc(legacyActualsRef);
            const snapshotsSnap = await getDoc(legacySnapshotsRef);

            await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'systems', 'default', 'solar_app', 'config'), legacyData);
            if (actualsSnap.exists()) await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'systems', 'default', 'solar_app', 'actuals'), actualsSnap.data());
            if (snapshotsSnap.exists()) await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'systems', 'default', 'solar_app', 'snapshots'), snapshotsSnap.data());
            
            setSystems([{ id: 'default', locationName: legacyData.locationName || "My Home" }]);
          } else {
            // Initialize fresh default if no legacy data
            const defaultSystemRef = doc(db, 'artifacts', appId, 'users', user.uid, 'systems', 'default');
            await setDoc(defaultSystemRef, { id: 'default', locationName: "My Home", createdAt: new Date().toISOString() });
            setSystems([{ id: 'default', locationName: "My Home" }]);
          }
        } else {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          setSystems(list);
        }
      } catch (err) {
        console.error("System Discovery/Migration Error:", err);
        setSystems([{ id: 'default', locationName: "My Home" }]);
      }
    });

    return () => unsubSystems();
  }, [user, appId, isDemo]);

  // --- 2. DATA SYNC FOR SELECTED SYSTEM ---
  useEffect(() => {
    if (!user || isDemo || !currentSystemId) return;

    setDbSyncing(true);
    setDbStatus("Connecting...");
    const timeoutId = setTimeout(() => setDbSyncing(false), 5000);

    const basePath = ['artifacts', appId, 'users', user.uid, 'systems', currentSystemId, 'solar_app'];
    const configRef = doc(db, ...basePath, 'config');
    const unsubConfig = onSnapshot(configRef, (docSnap) => {
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
        if (data.strings && data.strings.length > 0) {
           migrated.arraysSet = true;
           migrated.strings = data.strings.map(s => ({ ...s, wattage: s.wattage || 465 }));
        }
        setConfig(migrated);
      } else {
        setConfig({
          lat: null, long: null, eff: 0.85, schemaVersion: 2,
          locationSet: false, arraysSet: false, locationName: "",
          strings: [], effHistory: [], apiEnabled: false,
          excludedDays: [], acknowledgedOutliers: [],
          dailyConsumption: 12, batteryCapacity: 0, inverterACRating: null,
          onMicrogenScheme: false, exportRate: 0.21, importRate: 0.40,
          currency: "€", showEconomics: false
        });
      }
      setDbSyncing(false);
      setDbStatus("Connected");
    }, (err) => {
      console.error("Config Sync Error:", err);
      setDbSyncing(false);
    });

    const actualsRef = doc(db, ...basePath, 'actuals');
    const unsubActuals = onSnapshot(actualsRef, (docSnap) => {
      if (docSnap.exists()) {
        const rawActuals = docSnap.data();
        setActuals(rawActuals);
      } else {
        setActuals({});
      }
    }, (err) => console.error("Actuals Sync Error:", err));

    const snapshotsRef = doc(db, ...basePath, 'snapshots');
    const unsubSnapshots = onSnapshot(snapshotsRef, (docSnap) => {
      if (docSnap.exists()) {
        setSnapshots(docSnap.data());
      } else {
        setSnapshots({});
      }
    }, (err) => console.error("Snapshots Sync Error:", err));

    // Sigenergy Integration Listener
    const sigenRef = doc(db, 'users', user.uid, 'integrations', 'sigenergy');
    const unsubSigen = onSnapshot(sigenRef, (snap) => {
      if (snap.exists()) {
        setSigenergy(snap.data());
      } else {
        setSigenergy(null);
      }
    });

    return () => { 
      unsubConfig(); 
      unsubActuals();
      unsubSnapshots();
      unsubSigen();
      clearTimeout(timeoutId);
    };
  }, [user, appId, isDemo, currentSystemId]);

  const saveConfigToCloud = async (newConfig) => {
    const cleanConfig = sanitizeConfig(newConfig);
    if (newConfig.eff !== config.eff) {
      const historyEntry = { 
        val: newConfig.eff, 
        date: new Date().toISOString(),
        label: new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })
      };
      cleanConfig.effHistory = [historyEntry, ...(config.effHistory || [])].slice(0, 50);
    }
    setConfig(cleanConfig);
    if (!user || isDemo || !currentSystemId) return;
    setDbStatus("Saving...");
    try {
      const configRef = doc(db, 'artifacts', appId, 'users', user.uid, 'systems', currentSystemId, 'solar_app', 'config');
      await setDoc(configRef, cleanConfig, { merge: true });
      if (newConfig.locationName && newConfig.locationName !== config.locationName) {
        const systemRef = doc(db, 'artifacts', appId, 'users', user.uid, 'systems', currentSystemId);
        await setDoc(systemRef, { locationName: newConfig.locationName }, { merge: true });
      }
      setDbStatus("Saved");
      setLastSynced(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Failed to save config:", err);
      setDbStatus("Save Error");
    }
  };

  const saveActualToCloud = async (dayLabel, value) => {
    const newVal = { ...actuals, [dayLabel]: value };
    setActuals(newVal);
    if (!user || isDemo || !currentSystemId) return;
    setDbStatus(`Saving...`);
    try {
      const actualsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'systems', currentSystemId, 'solar_app', 'actuals');
      await setDoc(actualsRef, { [dayLabel]: value }, { merge: true });
      setDbStatus("Saved");
      setLastSynced(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Failed to save actuals:", err);
      setDbStatus("Save Error");
    }
  };

  const saveSnapshotToCloud = async (isoDate, modelledYield) => {
    const newVal = { ...snapshots, [isoDate]: modelledYield };
    setSnapshots(newVal);
    if (!user || isDemo || !currentSystemId) return;
    try {
      const snapshotsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'systems', currentSystemId, 'solar_app', 'snapshots');
      await setDoc(snapshotsRef, { [isoDate]: modelledYield }, { merge: true });
    } catch (err) {
      console.error("Failed to save snapshot:", err);
    }
  };

  const addNewSystem = async (name) => {
    if (!user || isDemo) return;
    const newId = 'sys_' + Date.now();
    const systemRef = doc(db, 'artifacts', appId, 'users', user.uid, 'systems', newId);
    await setDoc(systemRef, { 
      id: newId, 
      locationName: name, 
      createdAt: new Date().toISOString() 
    });
    setCurrentSystemId(newId);
    return newId;
  };

  const deleteSystem = async (systemId) => {
    if (!user || isDemo || systems.length <= 1) return;
    try {
      const { deleteDoc } = await import('firebase/firestore');
      const systemRef = doc(db, 'artifacts', appId, 'users', user.uid, 'systems', systemId);
      await deleteDoc(systemRef);
      if (systemId === currentSystemId) {
        const remaining = systems.filter(s => s.id !== systemId);
        if (remaining.length > 0) setCurrentSystemId(remaining[0].id);
      }
    } catch (err) {
      console.error("Failed to delete system:", err);
    }
  };

  const disconnectSystem = async () => {
    if (!user || isDemo) return;
    const { deleteDoc } = await import('firebase/firestore');
    const sigenRef = doc(db, 'users', user.uid, 'integrations', 'sigenergy');
    await deleteDoc(sigenRef);
  };

  const publishForecast = async (dailyTotals, hourlyData) => {
    if (!user || !config.apiEnabled || isDemo) return;
    try {
      const publicRef = doc(db, 'public_forecasts', user.uid);
      const summary = dailyTotals.map(d => ({
        day: d.dayLabel, yield: Number(d.yield.toFixed(2)), offset: d.dayOffset
      }));
      const hourly = (hourlyData || []).map(h => ({
        time: h.date.toISOString(), kw: h.p50, p10: h.p10, p50: h.p50, p90: h.p90
      }));
      await setDoc(publicRef, { 
        lastUpdate: new Date().toISOString(), forecast: summary, hourly, unit: "kWh",
        note: "Use p50 for most likely prediction. kw is deprecated and will be removed in v2."
      });
    } catch (e) { console.error("Public publish failed:", e); }
  };

  return { 
    config, actuals, snapshots, systems, sigenergy, currentSystemId, setCurrentSystemId,
    dbSyncing, dbStatus, lastSynced, saveConfigToCloud, saveActualToCloud,
    saveSnapshotToCloud, addNewSystem, deleteSystem, disconnectSystem, publishForecast
  };
};
