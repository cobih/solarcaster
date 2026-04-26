const admin = require("firebase-admin");
admin.initializeApp();

const { connectSigenergy } = require("./src/connectSigenergy");
const { pollRealtimeData } = require("./src/pollRealtimeData");
const { syncDailyYield } = require("./src/syncDailyYield");

exports.connectSigenergy = connectSigenergy;
exports.pollRealtimeData = pollRealtimeData;
exports.syncDailyYield = syncDailyYield;
