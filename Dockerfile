FROM node:22-bookworm-slim AS vlr-builder
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN git clone --depth 1 https://github.com/shreshth-s/vlr-api.git
WORKDIR /build/vlr-api
RUN npm install --no-audit --no-fund && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY . /app
COPY --from=vlr-builder /build/vlr-api /opt/vlr-api
RUN chmod +x /app/start-hosted.sh && mkdir -p /app/data
EXPOSE 8787
CMD ["/app/start-hosted.sh"]
