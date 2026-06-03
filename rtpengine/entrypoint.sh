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

if [ -n "$PRIVATE_IP" ]; then
    IFACE="${PRIVATE_IP}!${PUBLIC_IP}"
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
