'use strict';

// Minimal APNs (Apple Push Notification service) client for VoIP / PushKit pushes.
//
// Uses token-based auth (a .p8 AuthKey) and Apple's HTTP/2 API directly via
// Node's built-in `http2` — no heavy native push libraries. A signed JWT
// provider token is reused for ~50 min (Apple allows up to 60).
//
// VoIP specifics that MUST be right or Apple drops the push:
//   - apns-push-type: voip
//   - apns-topic:     <bundleId>.voip   (note the .voip suffix)
//   - apns-priority:  10

const fs = require('fs');
const http2 = require('http2');
const jwt = require('jsonwebtoken');

const {
  APNS_KEY_PATH,
  APNS_KEY_ID,
  APNS_TEAM_ID,
  APNS_BUNDLE_ID,
} = process.env;

const PRODUCTION = String(process.env.APNS_PRODUCTION).toLowerCase() === 'true';
const MOCK = String(process.env.APNS_MOCK).toLowerCase() === 'true';

const HOST = PRODUCTION
  ? 'https://api.push.apple.com:443'
  : 'https://api.sandbox.push.apple.com:443';

// VoIP topic is always "<bundleId>.voip".
const VOIP_TOPIC = APNS_BUNDLE_ID ? `${APNS_BUNDLE_ID}.voip` : undefined;

// --- Provider token (JWT, ES256) --------------------------------------------
let signingKey = null;
function getSigningKey() {
  if (!signingKey) signingKey = fs.readFileSync(APNS_KEY_PATH, 'utf8');
  return signingKey;
}

let cachedToken = null;
let cachedAt = 0;
function getProviderToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now - cachedAt < 50 * 60) return cachedToken;
  cachedToken = jwt.sign({ iss: APNS_TEAM_ID, iat: now }, getSigningKey(), {
    algorithm: 'ES256',
    header: { alg: 'ES256', kid: APNS_KEY_ID },
  });
  cachedAt = now;
  return cachedToken;
}

// --- HTTP/2 session (kept alive, lazily reconnected) ------------------------
let session = null;
function getSession() {
  if (session && !session.closed && !session.destroyed) return session;
  console.log('[apns] connecting HTTP/2 ->', HOST);
  session = http2.connect(HOST);
  session.once('connect', () => console.log('[apns] HTTP/2 connected ->', HOST));
  session.on('error', (err) => {
    // err.message is often empty for TLS/socket failures; log code + full error.
    console.error(`[apns] session error: code=${err.code || '?'} msg="${err.message || ''}"`);
    console.error(err);
    session = null;
  });
  // Underlying TLS/socket failures surface here, not always on 'error'.
  session.on('socketError', (err) => console.error('[apns] socketError:', err && err.code, err && err.message));
  session.on('goaway', (code, lastStreamID, opaqueData) => {
    console.error(`[apns] GOAWAY code=${code} opaque=${opaqueData ? opaqueData.toString() : ''}`);
    session = null;
  });
  return session;
}

function assertConfigured() {
  const missing = Object.entries({
    APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(`APNs not configured: missing ${missing.join(', ')} (or set APNS_MOCK=true)`);
  }
}

/**
 * Send a VoIP push.
 * @param {string} deviceToken hex PushKit token from the iOS app
 * @param {object} payload     dictionary delivered to the PushKit delegate
 * @returns {Promise<{statusCode:number, apnsId:?string, mock?:boolean}>}
 */
function sendVoipPush(deviceToken, payload) {
  if (MOCK) {
    console.log('[apns][mock] would send VoIP push to', deviceToken);
    return Promise.resolve({ statusCode: 200, apnsId: 'mock-id', mock: true });
  }

  return new Promise((resolve, reject) => {
    let cfgErr;
    try { assertConfigured(); } catch (e) { cfgErr = e; }
    if (cfgErr) return reject(cfgErr);

    const body = Buffer.from(JSON.stringify(payload));
    const req = getSession().request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${getProviderToken()}`,
      'apns-topic': VOIP_TOPIC,
      'apns-push-type': 'voip',
      'apns-priority': '10',
      'apns-expiration': '0',
      'content-type': 'application/json',
      'content-length': body.length,
    });

    let status = 0;
    let apnsId = null;
    let data = '';

    req.on('response', (h) => {
      status = h[':status'];
      apnsId = h['apns-id'] || null;
    });
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (status === 200) return resolve({ statusCode: 200, apnsId });
      let reason = data;
      try { reason = JSON.parse(data).reason || data; } catch (_) { /* keep raw */ }
      reject(Object.assign(new Error(`APNs rejected: ${status} ${reason}`), {
        statusCode: status, apnsId, reason,
      }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.close(http2.constants.NGHTTP2_CANCEL));

    req.write(body);
    req.end();
  });
}

module.exports = { sendVoipPush, VOIP_TOPIC, PRODUCTION, MOCK };
