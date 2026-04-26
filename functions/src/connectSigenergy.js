const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

const REGIONS = {
  EU: "https://openapi-eu.sigenergy.com",
  GLOBAL: "https://openapi.sigenergy.com",
};

/**
 * HTTPS Callable: connectSigenergy
 * Exchanges mySigen credentials for a token and stores it.
 */
exports.connectSigenergy = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be signed in.");
  }

  const { email, password, region = "EU" } = data;
  const uid = context.auth.uid;
  const baseUrl = REGIONS[region] || REGIONS.EU;

  try {
    // 1. Login to Sigenergy
    const loginRes = await axios.post(`${baseUrl}/login`, {
      username: email,
      password: password,
    });

    if (loginRes.data.code !== 0) {
      throw new Error(loginRes.data.message || "Invalid credentials");
    }

    const { token, refreshToken } = loginRes.data.data;

    // 2. Discover Stations (Systems)
    const stationRes = await axios.get(`${baseUrl}/station/list`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (stationRes.data.code !== 0 || !stationRes.data.data.list?.length) {
      throw new Error("No solar stations found on this account.");
    }

    const station = stationRes.data.data.list[0]; // Connect to the first one for now
    const stationId = station.stationId;

    // 3. Store Integration Metadata
    const db = admin.firestore();
    const integrationRef = db.collection("users").doc(uid).collection("integrations").doc("sigenergy");

    await integrationRef.set({
      token,
      refreshToken: refreshToken || null,
      region,
      stationId,
      status: "connected",
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSynced: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { 
      success: true, 
      stationId,
      locationName: station.stationName 
    };

  } catch (err) {
    console.error("Sigenergy Connection Error:", err.message);
    throw new functions.https.HttpsError("internal", err.message || "Failed to connect to Sigenergy.");
  }
});
