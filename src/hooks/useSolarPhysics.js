import { useState, useEffect } from 'react';

// --- BASE CONSTANTS ---
const LATITUDE = 53.3767;
const LONGITUDE = -6.3286;
const PANEL_WATTAGE = 465;
const ALBEDO = 0.2;

// --- SOLAR PHYSICS ENGINE ---
export const getSolarPosition = (date, lat, lon) => {
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

export const calculateArrayPower = (dni, dhi, temp, solarPos, panelAzimuthDeg, tiltDeg, capacityKw, efficiency) => {
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

export const useSolarPhysics = (config, dbSyncing) => {
  const [data, setData] = useState([]);
  const [dailyTotals, setDailyTotals] = useState([]);
  const [nowLabel, setNowLabel] = useState("");
  const [loading, setLoading] = useState(false); // Changed to false by default
  const [error, setError] = useState(null);

  useEffect(() => {
    if (dbSyncing || !config.lat || !config.long) return;

    const fetchSolarData = async () => {
      setLoading(true);
      setError(null);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const lat = config.lat || 53.3767;
      const long = config.long || -6.3286;

      try {
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${long}&hourly=temperature_2m,direct_normal_irradiance,diffuse_radiation,cloudcover&timezone=GMT&forecast_days=7&past_days=7`,
          { signal: controller.signal }
        );
        clearTimeout(timeoutId);
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
          const solarPos = getSolarPosition(date, lat, long);

          let totalKw = 0;
          const stringPowers = {};

          // Dynamic multi-string calculation
          (config.strings || []).forEach(s => {
            const stringCapacity = (s.count * (s.wattage || 465)) / 1000;
            const pwr = calculateArrayPower(dni, dhi, temp, solarPos, s.azimuth, s.tilt, stringCapacity, config.eff);
            totalKw += pwr;
            stringPowers[s.id] = Number(pwr.toFixed(2));
          });

          const localTimeLabel = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const dayLabel = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
          const fullLabel = `${dayLabel} ${localTimeLabel}`;

          const diff = Math.abs(date - now);
          if (diff < closestNowDiff) {
            closestNowDiff = diff;
            currentNowLabel = fullLabel;
          }

          const itemMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
          const dayOffset = Math.round((itemMidnight - todayMidnight) / (1000 * 60 * 60 * 24));
          // Robust Local ISO Key (YYYY-MM-DD)
          const isoDate = `${itemMidnight.getFullYear()}-${String(itemMidnight.getMonth() + 1).padStart(2, '0')}-${String(itemMidnight.getDate()).padStart(2, '0')}`;
          
          if (!totalsByDay[dayLabel]) {
            totalsByDay[dayLabel] = { date: itemMidnight, dayLabel, isoDate, dayOffset, yield: 0, strings: {} };
          }
          
          processedData.push({
            date, 
            dayLabel, 
            timeLabel: localTimeLabel, 
            fullLabel,
            total: Number(totalKw.toFixed(2)),
            stringPowers,
            cloudCover: hourly.cloudcover[i],
            cumulativeYield: Number(totalsByDay[dayLabel].yield.toFixed(2)),
          });

          totalsByDay[dayLabel].yield += totalKw;
          // Accumulate per-string daily yield
          Object.keys(stringPowers).forEach(id => {
            totalsByDay[dayLabel].strings[id] = (totalsByDay[dayLabel].strings[id] || 0) + stringPowers[id];
          });
        }

        const finalData = processedData.map(point => ({
          ...point,
          dayTotal: totalsByDay[point.dayLabel].yield
        }));

        setData(finalData);
        setNowLabel(currentNowLabel);
        setDailyTotals(Object.values(totalsByDay).sort((a, b) => a.date - b.date));
      } catch (err) {
        setError(err.name === 'AbortError' ? "Request timed out." : err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSolarData();
    const intervalId = setInterval(fetchSolarData, 5 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [config, dbSyncing]);

  const totalCapacity = (config.strings || []).reduce((acc, s) => acc + (s.count * (s.wattage || 465) / 1000), 0);

  return { data, dailyTotals, nowLabel, loading, error, totalCapacity };
};
