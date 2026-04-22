import { useState, useEffect } from 'react';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

export const useFirestoreSync = (user, appId) => {
  const [dbSyncing, setDbSyncing] = useState(false);
  const [dbStatus, setDbStatus] = useState("Idle");
  const [lastSynced, setLastSynced] = useState(null);

  const [config, setConfig] = useState({
    eff: 0.85,
    strings: [
      { id: 's1', name: "East String", azimuth: 90, tilt: 35, count: 11 },
      { id: 's2', name: "West String", azimuth: 270, tilt: 35, count: 9 }
    ],
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
        // Migration logic: If old flat config exists, convert it to the new multi-string format
        if (!data.strings && data.eastCount !== undefined) {
          console.log("Migrating legacy config to multi-string...");
          const migrated = {
            eff: data.eff || 0.85,
            strings: [
              { id: 's1', name: "East String", azimuth: 90, tilt: data.tilt || 35, count: data.eastCount || 0 },
              { id: 's2', name: "West String", azimuth: 270, tilt: data.tilt || 35, count: data.westCount || 0 }
            ]
          };
          setConfig(migrated);
        } else {
          setConfig(data);
        }
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
    setConfig(newConfig);
    if (!user) return;
    setDbStatus("Saving Config...");
    try {
      const configRef = doc(db, 'artifacts', appId, 'users', user.uid, 'solar_app', 'config');
      await setDoc(configRef, newConfig, { merge: true });
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
