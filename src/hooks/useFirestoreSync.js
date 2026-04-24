import { useState, useEffect } from 'react';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { sanitizeConfig } from '../utils/sanitize';

export const useFirestoreSync = (user, appId) => {
  const [dbSyncing, setDbSyncing] = useState(false);
  const [dbStatus, setDbStatus] = useState("Idle");
  const [lastSynced, setLastSynced] = useState(null);

  const [config, setConfig] = useState({
    lat: null,
    long: null,
    eff: 0.85,
    schemaVersion: 2,
    locationSet: false,
    arraysSet: false,
    strings: [],
    effHistory: [], // Track efficiency changes over time
  });

  const [actuals, setActuals] = useState({});

  useEffect(() => {
    if (!user) {
      setTimeout(() => {
        setDbSyncing(false);
        setDbStatus("Idle");
      }, 0);
      return;
    }

    const statusTimer = setTimeout(() => setDbStatus("Connecting..."), 0);
    const timeoutId = setTimeout(() => setDbSyncing(false), 5000);

    const configRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'config');
    const unsubConfig = onSnapshot(configRef, (docSnap) => {
      clearTimeout(timeoutId);
      if (docSnap.exists()) {
        const data = docSnap.data();
        
        // Advanced Migration: Ensure all new fields are present
        const migrated = { ...data };
        if (data.lat !== undefined && data.long !== undefined) migrated.locationSet = true;
        if (!data.effHistory) migrated.effHistory = [];
        
        if (data.strings && data.strings.length > 0) {
           migrated.arraysSet = true;
           // Ensure each string has a wattage (defaulting to our 465W if missing)
           migrated.strings = data.strings.map(s => ({
             ...s,
             wattage: s.wattage || 465
           }));
        }
        
        // Legacy multi-string migration
        if (!data.strings && data.eastCount !== undefined) {
          migrated.strings = [
            { id: 's1', name: "East String", azimuth: 90, tilt: data.tilt || 35, count: data.eastCount || 0, wattage: 465 },
            { id: 's2', name: "West String", azimuth: 270, tilt: data.tilt || 35, count: data.westCount || 0, wattage: 465 }
          ];
          migrated.arraysSet = true;
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
  }, [user, appId]);

  const saveConfigToCloud = async (newConfig) => {
    const cleanConfig = sanitizeConfig(newConfig);
    
    // Efficiency Tracking: If eff changed, record it in history
    if (newConfig.eff !== config.eff) {
      const historyEntry = { 
        val: newConfig.eff, 
        date: new Date().toISOString(),
        label: new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })
      };
      cleanConfig.effHistory = [historyEntry, ...(config.effHistory || [])].slice(0, 50);
    }

    setConfig(cleanConfig);
    if (!user) return;
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
    if (!user) return;
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

  return { 
    config, 
    actuals, 
    dbSyncing, 
    dbStatus, 
    lastSynced, 
    saveConfigToCloud, 
    saveActualToCloud 
  };
};
