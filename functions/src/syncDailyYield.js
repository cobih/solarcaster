const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const { refreshSigenergyToken, REGIONS } = require("./refreshSigenergyToken");

/**
 * Scheduled Function: syncDailyYield
 * Runs daily at 23:00 (Europe/Dublin)
 * Fetches daily total yield and writes to historical production.
 */
exports.syncDailyYield = functions.pubsub
  .schedule("0 23 * * *")
  .timeZone("Europe/Dublin")
  .onRun(async (context) => {
    const db = admin.firestore();
    const snap = await db.collectionGroup("integrations")
      .where("status", "==", "connected")
      .get();

    if (snap.empty) return null;

    // Use Dublin date for the document ID
    const today = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Dublin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const isoDate = formatter.format(today); // "YYYY-MM-DD"

    const results = await Promise.all(snap.docs.map(async (doc) => {
      const { token, stationId, region } = doc.data();
      const uid = doc.ref.parent.parent.id;
      const baseUrl = REGIONS[region] || REGIONS.EU;

      try {
        const dayRes = await axios.get(`${baseUrl}/station/day`, {
          params: { stationId, date: isoDate },
          headers: { Authorization: `Bearer ${token}` }
        });

        if (dayRes.data.code === 401 || dayRes.data.code === 403) {
          const newToken = await refreshSigenergyToken(uid);
          if (newToken) {
            const retryRes = await axios.get(`${baseUrl}/station/day`, {
              params: { stationId, date: isoDate },
              headers: { Authorization: `Bearer ${newToken}` }
            });
            if (retryRes.data.code === 0) return { uid, yield: retryRes.data.data.dailyPvEnergy };
          }
          return { uid, error: "Token refresh failed" };
        }

        if (dayRes.data.code === 0) {
          return { uid, yield: dayRes.data.data.dailyPvEnergy };
        } else {
          return { uid, error: dayRes.data.message };
        }
      } catch (err) {
        return { uid, error: err.message };
      }
    }));

    const batch = db.batch();
    results.forEach((res) => {
      if (res.yield !== undefined) {
        const historyRef = db.collection("users").doc(res.uid).collection("history").doc(isoDate);
        batch.set(historyRef, {
          actual_kwh: Number(res.yield.toFixed(2)),
          source: "sigenergy",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          calibration_excluded: false
        }, { merge: true });
      }
    });

    await batch.commit();
    return null;
  });
