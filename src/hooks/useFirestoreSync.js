import { useState, useEffect } from 'react';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { sanitizeConfig } from '../utils/sanitize';

export const useFirestoreSync = (user, appId) => {
  const isDemo = user?.uid === 'demo-user';
  
  const [dbSyncing, setDbSyncing] = useState(false);
  const [dbStatus, setDbStatus] = useState(isDemo ? "Demo Mode" : "Idle");
  const [lastSynced, setLastSynced] = useState(null);

  const [config, setConfig] = useState({
    lat: isDemo ? 53.3498 : null,
    long: isDemo ? -6.2603 : null,
    eff: 0.85,
    schemaVersion: 2,
    locationSet: isDemo,
    arraysSet: isDemo,
    locationName: isDemo ? "Dublin City (Demo)" : "",
    strings: isDemo ? [
      { id: 'd1', name: "Main Roof (South)", azimuth: 180, tilt: 35, count: 12, wattage: 400 }
    ] : [],
    effHistory: [],
    apiEnabled: isDemo, // Enable by default for demo
  });

  const [actuals, setActuals] = useState(isDemo ? {
    [new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })]: 14.5
  } : {});

  useEffect(() => {
    if (!user || isDemo) return;

    const statusTimer = setTimeout(() => setDbStatus("Connecting..."), 0);
    const timeoutId = setTimeout(() => setDbSyncing(false), 5000);

    const configRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'config');
    const unsubConfig = onSnapshot(configRef, (docSnap) => {
      clearTimeout(timeoutId);
      if (docSnap.exists()) {
        const data = docSnap.data();
        const migrated = { ...data };
        if (data.lat !== undefined && data.long !== undefined) migrated.locationSet = true;
        if (!data.effHistory) migrated.effHistory = [];
        if (data.apiEnabled === undefined) migrated.apiEnabled = false;
        if (data.strings && data.strings.length > 0) {
           migrated.arraysSet = true;
           migrated.strings = data.strings.map(s => ({ ...s, wattage: s.wattage || 465 }));
        }
        setConfig(migrated);
      }
      setDbSyncing(false);
    }, (err) => {
      console.error("Config Sync Error:", err);
      setDbSyncing(false);
    });

    const actualsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'actuals');
    const unsubActuals = onSnapshot(actualsRef, (docSnap) => {
      if (docSnap.exists()) {
        setActuals(docSnap.data());
      }
    }, (err) => console.error("Actuals Sync Error:", err));

    return () => { 
      unsubConfig(); 
      unsubActuals();
      clearTimeout(timeoutId);
      clearTimeout(statusTimer);
    };
  }, [user, appId, isDemo]);

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
    
    if (!user || isDemo) return;
    
    setDbStatus("Saving Config...");
    try {
      const configRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'config');
      await setDoc(configRef, cleanConfig, { merge: true });
      setDbStatus("Config Saved");
      setLastSynced(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Failed to save config:", err);
      setDbStatus("Save Error");
    }
  };

  const saveActualToCloud = async (dayLabel, value) => {
    const newVal = { ...actuals, [dayLabel]: value };
    setActuals(newVal);
    
    if (!user || isDemo) return;
    
    setDbStatus(`Saving Actual: ${dayLabel}`);
    try {
      const actualsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'actuals');
      await setDoc(actualsRef, { [dayLabel]: value }, { merge: true });
      setDbStatus("Actual Saved");
      setLastSynced(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Failed to save actuals:", err);
      setDbStatus("Save Error");
    }
  };

  const publishForecast = async (dailyTotals) => {
    if (!user || !config.apiEnabled || isDemo) return;
    try {
      const publicRef = doc(db, 'public_forecasts', user.uid);
      const summary = dailyTotals.map(d => ({
        day: d.dayLabel,
        yield: Number(d.yield.toFixed(2)),
        offset: d.dayOffset
      }));
      await setDoc(publicRef, { 
        lastUpdate: new Date().toISOString(),
        forecast: summary,
        unit: "kWh"
      });
    } catch (e) {
      console.error("Public publish failed:", e);
    }
  };

  return { 
    config, 
    actuals, 
    dbSyncing, 
    dbStatus, 
    lastSynced, 
    saveConfigToCloud, 
    saveActualToCloud,
    publishForecast
  };
};
