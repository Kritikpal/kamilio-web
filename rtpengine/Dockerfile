# rtpengine built from source on Debian, daemon-only, userspace forwarding.
# No kernel module is used, so the container does NOT need a privileged
# host or the xt_RTPENGINE module loaded. Fine for small/medium call volume.
#
# Multi-stage: build in one image, copy the single binary into a slim runtime.

ARG RTPENGINE_VERSION=mr12.5.1.1

############################
# Stage 1: build
############################
FROM debian:bookworm-slim AS build

ARG RTPENGINE_VERSION
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git build-essential pkg-config pandoc \
    libavcodec-dev libavfilter-dev libavformat-dev libavutil-dev \
    libswresample-dev libswscale-dev \
    libevent-dev libpcre2-dev libxmlrpc-core-c3-dev libhiredis-dev \
    libjson-glib-dev libcurl4-openssl-dev libpcap-dev libssl-dev \
    libglib2.0-dev libspandsp-dev zlib1g-dev libwebsockets-dev \
    libmosquitto-dev libopus-dev libncurses-dev gperf default-libmysqlclient-dev \
    libmnl-dev libnftnl-dev libiptc-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --branch ${RTPENGINE_VERSION} --depth 1 \
    https://github.com/sipwise/rtpengine.git .

# Build ONLY the userspace daemon (skip kernel module + iptables plugin).
RUN make -C daemon

############################
# Stage 2: runtime
############################
FROM debian:bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive

# Runtime shared libs only (no -dev, no compiler).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates iproute2 \
    libavcodec59 libavfilter8 libavformat59 libavutil57 \
    libswresample4 libswscale6 \
    libevent-2.1-7 libevent-pthreads-2.1-7 libpcre2-8-0 libxmlrpc-core-c3 libhiredis0.14 \
    libjson-glib-1.0-0 libcurl4 libpcap0.8 libssl3 \
    libglib2.0-0 libspandsp2 zlib1g libwebsockets17 \
    libmosquitto1 libopus0 libncurses6 libmariadb3 \
    libmnl0 libnftnl11 libip4tc2 libip6tc2 libxtables12 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/daemon/rtpengine /usr/local/bin/rtpengine
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# NG control port (Kamailio talks to this). Media ports use host networking.
EXPOSE 22222/udp

ENTRYPOINT ["/entrypoint.sh"]
