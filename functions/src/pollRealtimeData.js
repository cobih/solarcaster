const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const { refreshSigenergyToken, REGIONS } = require("./refreshSigenergyToken");

/**
 * Scheduled Function: pollRealtimeData
 * Runs every 5 minutes (06:00-22:00 Europe/Dublin)
 * Batches requests across all connected users.
 */
exports.pollRealtimeData = functions.pubsub
  .schedule("*/5 6-22 * * *")
  .timeZone("Europe/Dublin")
  .onRun(async (context) => {
    const db = admin.firestore();
    
    // 1. Find all connected Sigenergy integrations using Collection Group Query
    // Note: This requires a composite index on (status) for the 'sigenergy' collection ID.
    const snap = await db.collectionGroup("integrations")
      .where("status", "==", "connected")
      .get();

    if (snap.empty) {
      console.log("No connected Sigenergy accounts found.");
      return null;
    }

    console.log(`Polling realtime data for ${snap.size} users.`);

    const now = new Date();
    const expireAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h TTL

    // 2. Process in batch (using Promise.all for parallelism)
    const results = await Promise.all(snap.docs.map(async (doc) => {
      const { token, stationId, region } = doc.data();
      const uid = doc.ref.parent.parent.id; // doc path is users/{uid}/integrations/sigenergy
      const baseUrl = REGIONS[region] || REGIONS.EU;

      try {
        const realtimeRes = await axios.get(`${baseUrl}/station/realtime`, {
          params: { stationId },
          headers: { Authorization: `Bearer ${token}` }
        });

        // 3. Handle 401 Unauthorized (Expired Token)
        if (realtimeRes.data.code === 401 || realtimeRes.data.code === 403) {
          console.log(`Token expired for user ${uid}. Attempting refresh...`);
          const newToken = await refreshSigenergyToken(uid);
          if (newToken) {
            // Retry once with new token
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

    // 4. Write data to Firestore
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
      } else if (res.error) {
        console.error(`Error for user ${res.uid}:`, res.error);
      }
    });

    await batch.commit();
    return null;
  });
