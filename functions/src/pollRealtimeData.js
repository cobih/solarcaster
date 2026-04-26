const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const axios = require("axios");
const { refreshSigenergyToken, REGIONS } = require("./refreshSigenergyToken");

/**
 * 2nd Gen Scheduled Function: pollRealtimeData
 * Runs every 5 minutes (06:00-22:00 Europe/Dublin)
 */
exports.pollRealtimeData = onSchedule({
  schedule: "*/5 6-22 * * *",
  timeZone: "Europe/Dublin",
}, async (event) => {
  const db = admin.firestore();
  
  const snap = await db.collectionGroup("integrations")
    .where("status", "==", "connected")
    .get();

  if (snap.empty) return;

  const now = new Date();
  const expireAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h TTL

  const results = await Promise.all(snap.docs.map(async (doc) => {
    const { token, stationId, region } = doc.data();
    const uid = doc.ref.parent.parent.id;
    const baseUrl = REGIONS[region] || REGIONS.EU;

    try {
      const realtimeRes = await axios.get(`${baseUrl}/station/realtime`, {
        params: { stationId },
        headers: { Authorization: `Bearer ${token}` }
      });

      if (realtimeRes.data.code === 401 || realtimeRes.data.code === 403) {
        const newToken = await refreshSigenergyToken(uid);
        if (newToken) {
          const retryRes = await axios.get(`${baseUrl}/station/realtime`, {
            params: { stationId },
            headers: { Authorization: `Bearer ${newToken}` }
          });
          if (retryRes.data.code === 0) return { uid, data: retryRes.data.data };
        }
        return { uid, error: "Token refresh failed" };
      }

      if (realtimeRes.data.code === 0) {
        return { uid, data: realtimeRes.data.data };
      } else {
        return { uid, error: realtimeRes.data.message };
      }
    } catch (err) {
      return { uid, error: err.message };
    }
  }));

  const batch = db.batch();
  results.forEach((res) => {
    if (res.data) {
      const realtimeRef = db.collection("users").doc(res.uid).collection("sigenergy_realtime").doc();
      batch.set(realtimeRef, {
        pvPower: res.data.pvPower || 0,
        gridPower: res.data.gridPower || 0,
        loadPower: res.data.loadPower || 0,
        batteryPower: res.data.batteryPower || 0,
        batterySoc: res.data.batterySoc || 0,
        operatingMode: res.data.operatingMode || "Unknown",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        expireAt: admin.firestore.Timestamp.fromDate(expireAt)
      });
    }
  });

  await batch.commit();
});
