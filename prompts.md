You are a senior VoIP/SIP/Kamailio engineer.

Build a complete production-ready Kamailio setup for my use case.

My current setup:
- I have a Grandstream PBX.
- I have Kamailio running on a public cloud server using Docker/Docker Compose.
- I have Android and iOS mobile SIP apps.
- Android is receiving SIP calls in background.
- iOS is not receiving calls when the app is closed/background because iOS suspends SIP sockets.
- I want Kamailio to work as a SIP edge proxy in front of Grandstream PBX.
- Grandstream PBX should still handle PBX features like extensions, trunks, IVR, call recording, ring groups, voicemail, and normal PBX routing.
- Kamailio should handle mobile SIP registration, NAT, security, routing, and iOS push trigger.

Important rule:
Do not try to keep iOS SIP socket alive forever. iOS background calling must use APNs VoIP PushKit + CallKit.

Target architecture:

Grandstream PBX
    ↕ SIP trunk / peer
Kamailio SIP Edge Proxy
    ↕
Android SIP app / iOS SIP app
    ↕
Backend Push API
    ↕
Apple APNs VoIP Push
    ↕
iOS app with PushKit + CallKit

Use extension 711 as the example mobile user.

Assume:
- Kamailio public IP/domain: REPLACE_WITH_KAMAILIO_DOMAIN_OR_IP
- SIP domain: REPLACE_WITH_SIP_DOMAIN
- Grandstream PBX IP: REPLACE_WITH_GRANDSTREAM_IP
- Grandstream PBX SIP port: 5060
- Backend Push API URL: http://backend:3000/api/voip/incoming-call
- Backend API key: REPLACE_WITH_SECRET_API_KEY
- Database: PostgreSQL
- RTP relay should use rtpengine because mobile users are behind NAT.
- Kamailio should support UDP/TCP 5060 first.
- Also explain optional TLS 5061 and WebSocket/WSS if mobile app supports it.

I want you to generate a complete working setup with these deliverables:

1. Architecture
- Explain the full call flow.
- Explain Android flow.
- Explain iOS flow.
- Explain Grandstream to Kamailio flow.
- Explain Kamailio to Grandstream flow.
- Include an ASCII architecture diagram.

2. Docker Compose
Generate docker-compose.yml with:
- kamailio
- postgres for Kamailio database
- rtpengine
- optional backend API placeholder/service if useful
- shared network
- volumes for kamailio.cfg and config files
- environment variables
- ports:
  - 5060 UDP/TCP for SIP
  - 5061 TCP optional TLS
  - RTP media ports for rtpengine
- restart policies

3. Kamailio config files
Generate:
- kamailio/kamailio.cfg
- kamailio/kamctlrc
- optional kamailio/modules.cfg if needed
- SQL init script if needed

kamailio.cfg must include:
- module loading
- global parameters
- debug logging
- sanity checks
- Max-Forwards checks
- anti-scanning basics
- NAT detection
- REGISTER handling
- SIP authentication
- save location
- user location lookup
- routing from mobile users to Grandstream PBX
- routing from Grandstream PBX to mobile users
- iOS push trigger route
- RTP handling with rtpengine
- CANCEL/BYE handling
- in-dialog request handling
- failure route
- branch route
- reply route
- clear xlog logs for every important route

4. Kamailio modules
Use and configure where appropriate:
- sl
- tm
- rr
- maxfwd
- textops
- sanity
- xlog
- pv
- registrar
- usrloc
- auth
- auth_db
- db_postgres
- nathelper
- rtpengine
- http_client or http_async_client
- dispatcher if useful for Grandstream routing
- permissions or htable for trusted IPs and device metadata
- pike or htable for anti-scanning/rate limiting if useful

5. Database design
Create PostgreSQL schema/init scripts for:
- Kamailio subscriber/auth users
- Kamailio location/usrloc if needed
- mobile device metadata
- iOS push token mapping
- pending calls

Tables needed:
users:
- id
- extension
- username
- password_hash or ha1
- device_type: android / ios
- push_enabled
- active
- created_at
- updated_at

device_tokens:
- id
- user_id
- platform
- voip_push_token
- environment: sandbox / production
- updated_at

pending_calls:
- id
- sip_call_id
- from_extension
- to_extension
- status
- created_at
- expires_at

Also include example seed data for extension 711.

6. iOS push trigger logic
Implement Kamailio logic:

When INVITE arrives for extension 711 or any mobile extension:
- Extract destination extension from R-URI.
- Check if contact exists in usrloc/location.
- If registered:
  - route call to contact.
- If not registered:
  - check whether user is iOS and push_enabled.
  - if iOS push-enabled:
    - call backend API:
      POST /api/voip/incoming-call
    - send JSON:
      {
        "to": "711",
        "from": "<caller>",
        "sipCallId": "<call-id>",
        "source": "kamailio",
        "timestamp": "<current-time>",
        "reason": "ios_user_not_registered"
      }
    - keep transaction alive for a short window.
    - retry lookup after a few seconds if practical.
    - if iOS app re-registers, route call to new contact.
    - if user does not register, send 480 Temporarily Unavailable or route to Grandstream voicemail/fallback.
  - if not push-enabled:
    - return 480 Temporarily Unavailable or route to PBX fallback.

Give me two implementation approaches:
A. Simple first version:
- Trigger backend push.
- Return 100 Trying / 180 Ringing if possible.
- Use short retry/fallback logic.
- Easy to debug.

B. Production version:
- Use transaction suspend/resume or backend-controlled pending call state.
- Store pending calls in DB/Redis/backend.
- Backend notifies Kamailio when iOS app is online.
- Kamailio resumes/reroutes the call.

7. Backend API contract
Design backend APIs:

POST /api/voip/incoming-call
- Called by Kamailio.
- Validates API key.
- Finds user by extension.
- Checks iOS VoIP token.
- Sends APNs VoIP push.
- Creates pending call.
- Returns JSON.

POST /api/voip/register-device-token
- Called by iOS app.
- Stores PushKit VoIP token.

POST /api/voip/device-online
- Called by iOS app after waking/registering.
- Updates device status.

Include sample Node.js/Express or Spring Boot pseudo-code for these endpoints.
Include APNs VoIP push payload example.
Include request/response examples.

8. Grandstream PBX configuration
Explain exactly how to configure Grandstream conceptually:
- Create SIP trunk/peer to Kamailio.
- Route calls for mobile extensions like 711 to Kamailio.
- Accept calls from Kamailio IP.
- Send outbound mobile calls from Kamailio to PBX.
- Keep IVR/trunks/recording/ring groups in Grandstream.
- Mention any NAT/firewall settings needed.
- Mention how to avoid registration conflicts between Grandstream and Kamailio.

9. Android notes
Explain:
- Android app can maintain registration using foreground service.
- Use REGISTER refresh.
- Use TCP/TLS if possible.
- Disable battery optimization if required.
- Keep NAT alive with Kamailio nathelper.

10. iOS notes
Explain:
- iOS app must use PushKit.
- iOS app must report incoming call using CallKit.
- After receiving VoIP push, app should reconnect/register to Kamailio.
- Do not rely on background SIP socket.
- Normal Firebase push is not enough for reliable call wake-up.

11. RTP/media
Generate rtpengine config and Kamailio hooks:
- rtpengine_offer on INVITE
- rtpengine_answer on 200 OK
- rtpengine_delete on BYE/CANCEL/failure
- Explain direct media vs relayed media.
- Recommend relayed media for mobile NAT.

12. Firewall/security
Provide firewall rules:
- Open SIP 5060 UDP/TCP only as needed.
- Open RTP media range.
- Restrict Grandstream PBX traffic by IP.
- Restrict backend API access to Kamailio/internal network.
- Add fail2ban suggestion.
- Add SIP scanning protection.
- Prevent open relay.
- Authenticate REGISTER.
- Validate From/To/domain.

13. Testing commands
Give exact commands:
- Start stack:
  docker-compose up -d
- View logs:
  docker-compose logs -f --tail=100 kamailio
- Search logs for extension 711:
  docker-compose logs -f --tail=100 kamailio | grep 711
- Dump registrations:
  docker exec -it kamailio kamcmd ul.dump
- Check active dialogs/transactions if available.
- Check rtpengine:
  docker logs rtpengine
- Capture SIP:
  sngrep
  tcpdump -i any -n port 5060
  ngrep -W byline -d any port 5060
- Test backend push API:
  curl -X POST ...
- Test ports:
  nc -vz KAMAILIO_IP 5060
- Test Grandstream to Kamailio route.
- Test Android registration.
- Test iOS push flow.

14. Troubleshooting checklist
Include fixes for:
- REGISTER not saving
- Wrong Contact IP due to NAT
- INVITE not reaching app
- RTP one-way audio
- Grandstream not routing to Kamailio
- Kamailio not triggering backend
- iOS push received but CallKit not showing
- iOS app wakes but call fails
- 401/403 auth issues
- 404 user not found
- 480 temporarily unavailable
- Firewall blocking RTP
- SIP ALG/router issues

15. Final output format
Give me:
- Step-by-step implementation
- Full file tree
- Full docker-compose.yml
- Full kamailio.cfg
- Full kamctlrc
- Full SQL schema/init
- Backend API pseudo-code
- Grandstream config steps
- Testing checklist
- Troubleshooting checklist

Make the config practical, heavily commented, and suitable for production hardening.
Do not skip important details.
Use extension 711 in examples.