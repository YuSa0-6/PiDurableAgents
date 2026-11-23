FROM ghcr.io/cloudflare/computer-remote-exec:0.11.4 AS remote-exec

FROM node:22-bookworm-slim
ENV CI=1
RUN npm install --global pnpm@10 bun@1.4.4 \
  && apt-get update \
  && apt-get install --yes --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=remote-exec /usr/local/bin/remote-exec /usr/local/bin/remote-exec
WORKDIR /workspace
CMD ["sleep", "infinity"]
