'use strict';

// VoIP push HTTP service called by Kamailio when an INVITE arrives for a user
// who is NOT currently registered (iOS app suspended). Kamailio does:
//
//   POST http://node_app:5000/send-voip-push   {"deviceToken":"<hex>"}
//
// and logs the JSON response. We turn that into an APNs VoIP/PushKit push so
// the iOS app wakes, re-registers, and reports the call via CallKit.

const express = require('express');
const crypto = require('crypto');
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

  console.log('[server] received VoIP push request:', body);
  if (!deviceToken || typeof deviceToken !== 'string') {
    return res.status(400).json({ ok: false, error: 'deviceToken is required' });
  }

  // Kamailio currently sends only deviceToken. The rest are optional so you can
  // enrich the CallKit UI later (e.g. pass caller info from the SIP From header).
  const uuid = body.uuid || crypto.randomUUID();
  const callId = body.callId || null;
  const handle = body.callerNumber || body.from || 'unknown';
  const callerName = body.callerName || body.from || 'Incoming call';
  // Honor the video flag from the caller (accept either name). Hardcoding false
  // made CallKit report every call as audio-only, hiding video calls.
  const hasVideo = body.hasVideo === true || body.withVideo === true;

  // Payload delivered to the app's PushKit delegate. The iOS app reads `uuid`
  // and `handle` to report an incoming call to CallKit.
  const payload = {
    aps: {},
    uuid,
    callId,
    handle,
    callerName,
    hasVideo,
    sentAt: new Date().toISOString(),
  };

  try {
    const result = await sendVoipPush(deviceToken, payload);
    console.log(`[push] ok uuid=${uuid} apnsId=${result.apnsId} mock=${!!result.mock}`);
    return res.json({ ok: true, uuid, apnsId: result.apnsId, mock: !!result.mock });
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
