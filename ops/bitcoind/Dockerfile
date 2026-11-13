# Copied 2026-11-13 from the build ChainQuery runs in production: same version,
# tarball hash and trusted signer keys; only the label and ports changed.
#
# Bitcoin Core, built from the official signed release tarball.
#
# Trust chain:
#   1. We pull bitcoincore.org's pinned tarball + SHA256SUMS + SHA256SUMS.asc.
#   2. We import the GPG keys of three long-standing Bitcoin Core release
#      maintainers (W. van der Laan, M. Falke, hebasto). At least one of these
#      keys must have signed the SHA256SUMS file. If none have, the build
#      aborts.
#   3. We verify the tarball's actual SHA256 matches the entry in the
#      verified SHA256SUMS file.
#   4. Only after all of that succeeds do we extract and use bitcoind.
#
# Bumping the Bitcoin Core version:
#   - Update BITCOIN_VERSION below
#   - Update BITCOIN_TARBALL_SHA256 to the value from the new
#     SHA256SUMS file (download + verify offline first)
#   - Confirm at least one of the trusted signers has signed the new SHA256SUMS

ARG BITCOIN_VERSION=31.2
ARG BITCOIN_TARBALL_SHA256=2f38996afaa74dfa469a23bf4727887133dfc09784df1f21ddf1c74d0dc82300

# ---- stage 1: download + verify ----
FROM debian:bookworm-slim AS verify
ARG BITCOIN_VERSION
ARG BITCOIN_TARBALL_SHA256

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp

# Long-standing Bitcoin Core release signers. Each key here has signed
# multiple historical releases. This is intentionally a small subset of the
# full builder-keys list so the trust set is auditable; if any of these keys
# rotate, this Dockerfile must be updated.
COPY trusted-keys/ /trusted-keys/

RUN gpg --import /trusted-keys/*.asc

RUN curl -sSLO "https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}/bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz" \
 && curl -sSLO "https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}/SHA256SUMS" \
 && curl -sSLO "https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}/SHA256SUMS.asc"

# 1. Verify SHA256SUMS was signed by at least one of our trusted keys.
RUN gpg --verify SHA256SUMS.asc SHA256SUMS 2>&1 \
    | grep -E "Good signature from .*(Wladimir|laanwj|fanquake|hebasto)" \
    || (echo "FATAL: SHA256SUMS not signed by any trusted Bitcoin Core key" >&2 && exit 1)

# 2. Verify the tarball's actual hash matches what the verified SHA256SUMS says.
RUN grep "bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz" SHA256SUMS \
    | sha256sum -c -

# 3. Defense-in-depth: also check against the hash baked into this Dockerfile.
#    If bitcoincore.org ever serves a different (signed) SHA256SUMS,
#    this catches the divergence.
RUN echo "${BITCOIN_TARBALL_SHA256}  bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz" \
    | sha256sum -c -

RUN tar -xzf "bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz" \
 && mkdir -p /out \
 && cp -v "bitcoin-${BITCOIN_VERSION}/bin/bitcoind" /out/ \
 && cp -v "bitcoin-${BITCOIN_VERSION}/bin/bitcoin-cli" /out/

# ---- stage 2: minimal runtime ----
FROM debian:bookworm-slim
ARG BITCOIN_VERSION

LABEL org.opencontainers.image.title="bitcoind" \
      org.opencontainers.image.source="https://github.com/treib-holdings/learnbitcoin-practice" \
      org.opencontainers.image.description="Bitcoin Core built from official signed release" \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        wget \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1000 bitcoin \
 && useradd --system --uid 1000 --gid bitcoin --home /home/bitcoin --shell /usr/sbin/nologin --create-home bitcoin \
 && mkdir -p /data/bitcoin \
 && chown bitcoin:bitcoin /data/bitcoin

COPY --from=verify /out/bitcoind /usr/local/bin/bitcoind
COPY --from=verify /out/bitcoin-cli /usr/local/bin/bitcoin-cli

ENV BITCOIN_VERSION=${BITCOIN_VERSION}

USER bitcoin
WORKDIR /data/bitcoin
VOLUME ["/data/bitcoin"]

# Regtest ports: 18443 RPC, 18444 P2P (not listened on; see bitcoin.conf)
# ZMQ: 28332 (rawblock), 28333 (rawtx) — used by Fulcrum + mempool
EXPOSE 18443 28332 28333

ENTRYPOINT ["bitcoind"]
CMD ["-conf=/data/bitcoin/bitcoin.conf", "-datadir=/data/bitcoin"]
