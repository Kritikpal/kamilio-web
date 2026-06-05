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
const { pool } = require('./db');

const app = express();
// Body parsers (built into Express, no extra dependency):
//  - json:       Content-Type: application/json
//  - urlencoded: Content-Type: application/x-www-form-urlencoded (HTML form / curl -d)
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));

const PORT = parseInt(process.env.PORT || '5000', 10);

// Constant-time string compare (avoids leaking the password via timing).
// timingSafeEqual requires equal-length buffers, so length-mismatch -> false.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

app.get('/health', (req, res) => {
  res.json({ ok: true, mock: MOCK, production: PRODUCTION, topic: VOIP_TOPIC || null });
});

// Hard unregister: authenticate the user (username + password against the same
// user_details table Kamailio uses) and NULL their VoIP push token, so future
// INVITEs for them skip the push instead of waking a device that has logged out.
//
//   POST /hard-unregister   {"username":"711","password":"secret711"}
//   (optionally include "domain" to disambiguate)
//
// Note: this only clears the push token. Any live usrloc registration ages out
// on its own (db_mode=0, in-memory) or on the next Expires:0 REGISTER.
app.post('/hard-unregister', async (req, res) => {
  const body = req.body || {};
  const { username, password, domain } = body;
  // Short id to correlate the log lines of a single request. NEVER log password.
  const reqId = crypto.randomBytes(4).toString('hex');
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  console.log(`[hard-unregister][${reqId}] request from ${ip} username=${username || '(missing)'} domain=${domain || '(none)'}`);

  if (typeof username !== 'string' || !username ||
      typeof password !== 'string' || !password) {
    console.warn(`[hard-unregister][${reqId}] rejected 400 -> username and password are required`);
    return res.status(400).json({ ok: false, error: 'username and password are required' });
  }

  try {
    // username is UNIQUE in user_details; optionally constrain by domain.
    const params = [username];
    let sql = 'SELECT id, password, device_token FROM user_details WHERE username = ?';
    if (typeof domain === 'string' && domain) {
      sql += ' AND domain = ?';
      params.push(domain);
    }
    sql += ' LIMIT 1';

    console.log(`[hard-unregister][${reqId}] looking up user...`);
    const [rows] = await pool.query(sql, params);
    const user = rows[0];

    if (!user) {
      console.warn(`[hard-unregister][${reqId}] auth failed 401 -> user not found (username=${username})`);
      return res.status(401).json({ ok: false, error: 'invalid credentials' });
    }

    // Generic failure (do not reveal whether it was a wrong password vs no user).
    if (!safeEqual(password, user.password)) {
      console.warn(`[hard-unregister][${reqId}] auth failed 401 -> wrong password (username=${username}, id=${user.id})`);
      return res.status(401).json({ ok: false, error: 'invalid credentials' });
    }

    console.log(`[hard-unregister][${reqId}] authenticated id=${user.id}; current token=${user.device_token ? 'set' : 'null'} -> clearing`);
    const [result] = await pool.query(
      "UPDATE user_details SET device_token = NULL, status = 'offline' WHERE id = ?",
      [user.id],
    );
    console.log(`[hard-unregister][${reqId}] done 200 -> token cleared for ${username} (affected=${result.affectedRows})`);
    return res.json({ ok: true, username, cleared: result.affectedRows > 0 });
  } catch (err) {
    console.error(`[hard-unregister][${reqId}] error 500 -> ${err.message}`);
    return res.status(500).json({ ok: false, error: 'internal error' });
  }
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
