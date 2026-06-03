'use strict';

// VoIP push HTTP service called by Kamailio when an INVITE arrives for a user
// who is NOT currently registered (iOS app suspended). Kamailio does:
//
//   POST http://node_app:5000/send-voip-push   {"deviceToken":"<hex>"}
//
// and logs the JSON response. We turn that into an APNs VoIP/PushKit push so
// the iOS app wakes, re-registers, and reports the call via CallKit.

const express = require('express');
const { sendVoipPush, MOCK, PRODUCTION, VOIP_TOPIC } = require('./apns');

const app = express();
app.use(express.json({ limit: '16kb' }));

const PORT = parseInt(process.env.PORT || '5000', 10);

app.get('/health', (req, res) => {
  res.json({ ok: true, mock: MOCK, production: PRODUCTION, topic: VOIP_TOPIC || null });
});

app.post('/send-voip-push', async (req, res) => {
  const body = req.body || {};
  const { deviceToken } = body;

  if (!deviceToken || typeof deviceToken !== 'string') {
    return res.status(400).json({ ok: false, error: 'deviceToken is required' });
  }

  // Kamailio sends `from` (caller) and `callId`. Map them to the fields the iOS
  // app expects; explicit callerName/callerNumber/withVideo override if provided.
  const callerName = body.callerName || body.from || 'Incoming call';
  const callerNumber = body.callerNumber || body.from || 'unknown';
  const withVideo = body.withVideo === true || body.withVideo === 'true';

  // Exact payload the app expects (matches the manual APNs curl).
  const payload = {
    aps: { 'content-available': 1 },
    callerName,
    callerNumber,
    withVideo,
  };

  try {
    const result = await sendVoipPush(deviceToken, payload);
    console.log(`[push] ok caller=${callerName} apnsId=${result.apnsId} mock=${!!result.mock}`);
    return res.json({ ok: true, apnsId: result.apnsId, mock: !!result.mock });
  } catch (err) {
    console.error(`[push] failed: ${err.message}`);
    return res.status(502).json({
      ok: false,
      error: err.message,
      statusCode: err.statusCode || null,
      reason: err.reason || null,
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[voip-push] listening on :${PORT} (mock=${MOCK}, production=${PRODUCTION}, topic=${VOIP_TOPIC || 'UNSET'})`,
  );
});
