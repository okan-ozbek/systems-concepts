FROM debian:bookworm-slim
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates curl libstdc++6 && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in amd64) ARCH=x86_64 ;; arm64) ARCH=arm64 ;; *) exit 1 ;; esac \
    && curl -fL --retry 3 https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-30/wasi-sdk-30.0-${ARCH}-linux.tar.gz -o /tmp/sdk.tar.gz \
    && mkdir /opt/wasi-sdk && tar -xzf /tmp/sdk.tar.gz -C /opt/wasi-sdk --strip-components=1 && rm /tmp/sdk.tar.gz
WORKDIR /app
COPY compiler/*.py compiler/trace.hpp /app/
USER 65534:65534
EXPOSE 9000
CMD ["python3", "server.py"]
