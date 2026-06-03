#!/bin/sh
set -e

# ---------------------------------------------------------------------------
# rtpengine entrypoint
#
# Builds the --interface flag from env vars. This is THE critical setting:
#   - On a normal public server (public IP is on the NIC):
#       PUBLIC_IP=1.2.3.4   PRIVATE_IP=(unset)
#       -> --interface=1.2.3.4
#   - On a cloud VM with 1:1 NAT (AWS/GCP/Azure: only a private IP on the NIC,
#     public IP mapped externally):
#       PUBLIC_IP=1.2.3.4   PRIVATE_IP=10.0.0.5
#       -> --interface=10.0.0.5!1.2.3.4   (listen on private, advertise public)
# ---------------------------------------------------------------------------

: "${PUBLIC_IP:?Set PUBLIC_IP to the server's public IP address}"
: "${NG_LISTEN:=0.0.0.0:22222}"     # NG control port Kamailio connects to
: "${PORT_MIN:=30000}"
: "${PORT_MAX:=40000}"
: "${LOG_LEVEL:=6}"                 # 7=debug, 6=info, 5=notice
: "${TIMEOUT:=60}"                  # drop call if no RTP for N seconds
: "${SILENT_TIMEOUT:=3600}"

# Decide what to bind vs. advertise.
#
# rtpengine must BIND a media address that actually exists on a local interface.
# If we tell it to bind PUBLIC_IP but that IP is not on any local NIC (the usual
# case on AWS/GCP/Azure and many VPS behind 1:1 NAT), every media-port bind fails
# and rtpengine reports "Ran out of ports" on the very first call.
#
# So: if PRIVATE_IP isn't given, auto-detect. If PUBLIC_IP is already a local
# address, bind it directly. Otherwise bind the primary local IP and ADVERTISE
# PUBLIC_IP (the "bind!advertise" form), which is what makes media work behind NAT.
if [ -z "$PRIVATE_IP" ]; then
    if ip -o addr show 2>/dev/null | grep -qw "$PUBLIC_IP"; then
        : # PUBLIC_IP is on a local NIC (plain public server) -> bind it directly.
    else
        PRIVATE_IP="$(ip -o -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p')"
        if [ -n "$PRIVATE_IP" ]; then
            echo "[rtpengine] PUBLIC_IP ${PUBLIC_IP} is not a local interface; auto-detected PRIVATE_IP=${PRIVATE_IP}"
        else
            echo "[rtpengine] WARNING: could not auto-detect a local IP; binding ${PUBLIC_IP} may fail (set PRIVATE_IP explicitly)"
        fi
    fi
fi

if [ -n "$PRIVATE_IP" ]; then
    IFACE="${PRIVATE_IP}!${PUBLIC_IP}"   # bind private, advertise public
else
    IFACE="${PUBLIC_IP}"
fi

echo "[rtpengine] interface=${IFACE} ng=${NG_LISTEN} ports=${PORT_MIN}-${PORT_MAX}"

exec /usr/local/bin/rtpengine \
    --foreground \
    --log-stderr \
    --log-level="${LOG_LEVEL}" \
    --interface="${IFACE}" \
    --listen-ng="${NG_LISTEN}" \
    --port-min="${PORT_MIN}" \
    --port-max="${PORT_MAX}" \
    --timeout="${TIMEOUT}" \
    --silent-timeout="${SILENT_TIMEOUT}" \
    --table=-1 \
    --delete-delay=0 \
    ${EXTRA_OPTS}
