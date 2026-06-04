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

  const uuid = body.uuid || crypto.randomUUID();
  const callId = body.callId || null;
  // pushHint correlates this push with the SIP INVITE (Kamailio puts the same
  // value in an X-PushHint header on the INVITE). Siprix matches them so the
  // CallKit call binds to the SIP call. Falls back to callId if not provided.
  const pushHint = body.pushHint || body.callId || null;
  // Caller identity (accept Siprix names + our older names).
  const callerId = body.callerId || body.callerNumber || body.from || 'unknown';
  const callerName = body.callerName || callerId || 'Incoming call';
  // Honor the video flag (accept either name). Hardcoding false made CallKit
  // report every call as audio-only, hiding video calls.
  const withVideo = body.withVideo === true || body.hasVideo === true;

  // Payload delivered to the app's PushKit delegate. Siprix-standard fields
  // (callerId/callerName/withVideo/pushHint) plus our older fields for
  // backward compatibility with the existing app handler.
  const payload = {
    aps: {},
    pushHint,
    callerId,
    callerName,
    withVideo,
    callId,
    // backward-compat aliases (older app builds read these):
    uuid,
    handle: callerId,
    hasVideo: withVideo,
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
