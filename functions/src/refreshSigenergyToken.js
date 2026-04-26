const admin = require("firebase-admin");
const axios = require("axios");

const REGIONS = {
  EU: "https://api-eu.sigencloud.com/v1",
  AUS: "https://api-aus.sigencloud.com/v1",
  GLOBAL: "https://api.sigencloud.com/v1",
};

/**
 * Internal Utility: refreshSigenergyToken
 * Refreshes the session token using a refresh token.
 */
async function refreshSigenergyToken(uid) {
  const db = admin.firestore();
  const integrationRef = db.collection("users").doc(uid).collection("integrations").doc("sigenergy");
  const doc = await integrationRef.get();

  if (!doc.exists) return null;
  const { refreshToken, region } = doc.data();
  if (!refreshToken) {
    await integrationRef.update({ status: "disconnected" });
    return null;
  }

  const baseUrl = REGIONS[region] || REGIONS.EU;

  try {
    const res = await axios.post(`${baseUrl}/token/refresh`, {
      refreshToken,
    });

    if (res.data.code === 0) {
      const { token, refreshToken: newRefreshToken } = res.data.data;
      await integrationRef.update({
        token,
        refreshToken: newRefreshToken || refreshToken, // reuse if not rotated
        status: "connected",
        lastSynced: admin.firestore.FieldValue.serverTimestamp(),
      });
      return token;
    } else {
      await integrationRef.update({ status: "disconnected" });
      return null;
    }
  } catch (err) {
    console.error(`Token refresh failed for user ${uid}:`, err.message);
    await integrationRef.update({ status: "disconnected" });
    return null;
  }
}

module.exports = { refreshSigenergyToken, REGIONS };
