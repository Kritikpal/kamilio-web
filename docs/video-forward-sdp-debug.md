# Forwarded-call video debug: SDP capture + checklist

**Symptom:** Outdoor device (ext 11) → indoor (ext 12); on no-answer the call is
forwarded to **711** (mobile app) via the Kamailio trunk on the Grandstream UCM.
On the **forwarded** call the mobile shows **no video** (audio is fine). A
**direct** 12 → 711 call shows video correctly.

**Confirmed root cause (from rtpengine + mobile WebRTC logs):**
On the forwarded call the doorphone transmits **0 video packets**, and rtpengine
resolves the doorphone leg's video as **`unknown codec`**. The mobile app
(`siprix`/libwebrtc) only ever runs its **outbound** encoder — it has **zero
inbound video decode activity** and throws **malformed-RTCP / no-RR** errors.
Audio survives because PCMU is static payload type 0 (no rtpmap needed).

> Net: the **video codec negotiation in the forwarded offer SDP is broken** — the
> codec offered to the app is missing its `a=rtpmap` or is one the app can't
> decode (e.g. H265). The fix lives on the **Grandstream UCM forwarding trunk**,
> not in Kamailio/rtpengine.

The job below is to **prove which of the two** it is (missing rtpmap vs.
unsupported/narrowed codec) with one capture.

---

## 1. Capture on the Kamailio host

Run during a **forwarded** test call, then again during a **direct** call.

### Option A — sngrep (interactive, easiest)

```sh
# All SIP on 5060; press F2 to save, ENTER on a call to see the SDP bodies.
sngrep -d any port 5060

# Or capture straight to a pcap for one call window:
sngrep -d any -O forwarded.pcap port 5060      # do the forwarded call, then Ctrl-C
sngrep -d any -O direct.pcap    port 5060      # do the direct call, then Ctrl-C
```

In sngrep: open the INVITE dialog → you see the **offer** (INVITE) and **answer**
(200 OK) SDP side by side. Look at the `m=video` block in each.

### Option B — tshark (non-interactive, greppable)

```sh
# Capture
tshark -i any -f "port 5060" -w forwarded.pcap     # run the forwarded call
tshark -i any -f "port 5060" -w direct.pcap        # run the direct call

# Dump only the SDP media + attribute lines from every SIP message:
tshark -r forwarded.pcap -Y "sip" \
  -T fields -e sip.CSeq.method -e sip.Status-Code -e sdp.media -e sdp.media.attr \
  -E separator='|'

# Or pull the raw SDP bodies to read by eye:
tshark -r forwarded.pcap -Y "sip && sdp" -O sip
```

> If Kamailio runs in Docker (bridge net), capture on the **host** interface that
> carries 5060, or `docker exec` into the kamailio container and run tshark there.
> The trunk INVITE from the UCM and the leg to the app both pass through 5060.

---

## 2. What to compare — the four SDP bodies

For each call you have two messages with SDP that matter:

| # | Message | Direction | What it tells you |
|---|---------|-----------|-------------------|
| 1 | **INVITE offer** arriving from the UCM trunk | UCM → Kamailio | the **doorphone's offered video codec** (this is the `unknown codec` leg) |
| 2 | **200 OK answer** from the app | app → Kamailio | whether the app **accepted or declined** video |

Compare **forwarded #1** vs **direct #1** (the offers) first — that is where the
break is.

### Read the `m=video` block

A healthy H264 video offer looks like:

```
m=video 4002 RTP/AVP 99
a=rtpmap:99 H264/90000
a=fmtp:99 profile-level-id=42801f;packetization-mode=1
a=rtcp-fb:99 nack
a=rtcp-fb:99 nack pli
```

The **payload type number on the `m=video` line MUST have a matching
`a=rtpmap:<pt> ...` line.** That is the single most important thing to verify.

---

## 3. Checklist — tick these against the **forwarded** offer SDP (message #1)

- [ ] **`m=video` line is present** and the port is **non-zero**
      (`m=video 0 ...` means video was declined → look one hop upstream at the UCM).
- [ ] **Every PT listed on `m=video` has an `a=rtpmap:<pt> <codec>/90000` line.**
      A PT with no rtpmap = rtpengine's `unknown codec`. **This is the prime suspect.**
- [ ] The codec is one the app supports — expect **`H264/90000`**.
      If it says **`H265/90000` / `HEVC`** (or only an exotic PT), the app
      (libwebrtc) can't decode it → no video. **Second suspect.**
- [ ] If H264, the **`a=fmtp` `profile-level-id`** matches what the direct call
      offers (a profile the app accepts, e.g. `42e01f` / `42801f`).
- [ ] The SDP body is **not truncated** — it ends cleanly with full `a=` lines,
      not cut off mid-line. (Forwarded UCM SDPs are larger; truncation drops the
      trailing video attributes first. Cross-check `Content-Length` vs the actual
      body size.)
- [ ] Compare PT **numbers** forwarded vs direct. rtpengine relays RTP without
      rewriting payload types, so a PT that differs from what the app answers also
      breaks decode.

### Then check the app's **answer** (message #2)

- [ ] `m=video` port **non-zero** (zero = app declined video → confirms the offer
      gave it nothing decodable).
- [ ] The answered video PT/codec matches the offer.

---

## 4. Likely findings → fix

| Finding in forwarded offer SDP | Meaning | Fix (on Grandstream UCM trunk) |
|--------------------------------|---------|--------------------------------|
| `m=video` PT has **no `a=rtpmap`** | rtpmap stripped in forward | Stop the trunk/forward profile from stripping video attributes; preserve full rtpmap/fmtp |
| Codec is **H265/HEVC** (or non-H264) | Forward narrowed codec to one the app can't decode | Force **H264** on the trunk to 711; remove H265 from the forwarded offer |
| Wrong/mismatched **profile-level-id** | App rejects the H264 profile | Match the profile the direct extension offers |
| Body **truncated** (Content-Length mismatch) | SDP too large in forward path | Trim offered codec list on the trunk so SDP fits; check UCM/SBC body limits |
| `m=video 0` in the offer | UCM already dropped video before Kamailio | Enable video on the call-forward / trunk codec config on the UCM |

In all cases the corrective config is on the **UCM forwarding trunk to 711** —
make its forwarded **video** offer identical to what the **direct** 12 → 711 path
sends (which already works).

---

## 5. Secondary cleanups (after video negotiates)

These are not the root cause but improve robustness; do them once video flows.

- **rtcp-mux for the WebRTC leg.** `kamailio.cfg` passes only
  `replace-origin replace-session-connection ICE=force/remove` — no rtcp-mux
  handling. siprix/libwebrtc expects rtcp-mux; bridging it to the non-muxed SIP
  side without telling rtpengine contributes to the malformed-RTCP messages in
  the app log. Add `rtcp-mux-demux` on the app-facing **offer**:

  ```
  rtpengine_offer("replace-origin replace-session-connection ICE=force rtcp-mux-demux");
  ```
  (Keep `rtcp-mux-demux` only on the leg facing the app; the SIP side stays
  non-muxed.)

- **App-layer 404.** `flutter: Device monitoring error: DioException … 404` is the
  app's REST call (not SIP/media). If that endpoint gates the video UI, fix the
  route in `node_app/server.js`. Unrelated to the media negotiation.

---

## 6. One-line summary for the UCM admin

> On a **forwarded** call to 711 the trunk's INVITE offers video the mobile can't
> use (missing `a=rtpmap` or a non-H264 codec), so the doorphone sends no video.
> Make the **forwarded video offer match the direct 12→711 offer**: H264 with a
> complete `a=rtpmap`/`a=fmtp` and an untruncated SDP. Capture proof:
> `sngrep -d any port 5060`, compare the `m=video` block of the forwarded vs
> direct INVITE.
