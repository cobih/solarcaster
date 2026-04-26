const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

const REGIONS = {
  EU: "https://openapi-eu.sigenergy.com",
  GLOBAL: "https://openapi.sigenergy.com",
};

/**
 * 2nd Gen HTTPS Callable: connectSigenergy
 */
exports.connectSigenergy = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be signed in.");
  }

  const { email, password, region = "EU", solarcasterSystemId } = request.data;
  const uid = request.auth.uid;
  const baseUrl = REGIONS[region] || REGIONS.EU;

  if (!solarcasterSystemId) {
    throw new HttpsError("invalid-argument", "solarcasterSystemId is required.");
  }

  try {
    const loginRes = await axios.post(`${baseUrl}/login`, {
      username: email,
      password: password,
    });

    if (loginRes.data.code !== 0) {
      throw new Error(loginRes.data.message || "Invalid credentials");
    }

    const { token, refreshToken } = loginRes.data.data;

    const stationRes = await axios.get(`${baseUrl}/station/list`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (stationRes.data.code !== 0 || !stationRes.data.data.list?.length) {
      throw new Error("No solar stations found on this account.");
    }

    const station = stationRes.data.data.list[0];
    const stationId = station.stationId;

    const db = admin.firestore();
    const integrationRef = db.collection("users").doc(uid).collection("integrations").doc("sigenergy");

    await integrationRef.set({
      token,
      refreshToken: refreshToken || null,
      region,
      stationId,
      solarcasterSystemId,
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
    throw new HttpsError("internal", err.message || "Failed to connect to Sigenergy.");
  }
});
