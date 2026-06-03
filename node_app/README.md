# VoIP push service

Tiny HTTP service that Kamailio calls to send an **APNs VoIP / PushKit** push to
an offline iOS user, so the app wakes up, re-registers, and shows the call via
CallKit.

## Contract (what Kamailio calls)

```
POST /send-voip-push
Content-Type: application/json

{ "deviceToken": "<hex PushKit token>" }
```

Optional extra fields (Kamailio doesn't send these today, but the endpoint
accepts them for richer CallKit display): `from`, `callerName`, `callerNumber`,
`callId`, `uuid`.

Response: `{ "ok": true, "uuid": "...", "apnsId": "...", "mock": false }`

`GET /health` returns the running config (mock/production/topic).

## Running

Built and wired into the stack as the `node_app` service in
`../docker-compose.yml`. By default it runs with `APNS_MOCK=true` so the stack
comes up without Apple credentials — pushes are logged and "succeed" without
contacting Apple.

## Going to production

1. Create a **VoIP Services** key (or an APNs Auth Key `.p8`) in the Apple
   Developer portal. Note its **Key ID** and your **Team ID**.
2. Mount the `.p8` into the container and set the env vars (see `.env.example`):
   ```yaml
   node_app:
     environment:
       APNS_MOCK: "false"
       APNS_PRODUCTION: "false"   # true for App Store/TestFlight builds
       APNS_KEY_PATH: "/secrets/AuthKey.p8"
       APNS_KEY_ID: "ABCDE12345"
       APNS_TEAM_ID: "FGHIJ67890"
       APNS_BUNDLE_ID: "com.yourcompany.yourapp"
     volumes:
       - ./secrets/AuthKey.p8:/secrets/AuthKey.p8:ro
   ```
3. The APNs topic is derived automatically as `<APNS_BUNDLE_ID>.voip`.
