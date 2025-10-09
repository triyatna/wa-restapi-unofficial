FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat curl dumb-init
WORKDIR /srv/warest
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat curl dumb-init su-exec

ARG BUILD_VERSION=0.0.0
ARG BUILD_COMMIT=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="warest-whatsapp-web-multi" \
      org.opencontainers.image.description="WARest - WhatsApp Web Multi" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${BUILD_COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/triyatna/warest-whatsapp-web-multi" \
      org.opencontainers.image.documentation="https://github.com/triyatna/warest-whatsapp-web-multi#readme"

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000
ENV APP_STORAGE_ROOT=/data
ENV ADMIN_API_KEY=changeme-admin-key
ENV USER_API_KEYS=
ENV AUTHENTICATION=admin:admin123
ENV ALLOWED_ORIGINS=http://localhost:4000,http://127.0.0.1:4000

WORKDIR /srv/warest

COPY --from=deps /srv/warest/node_modules ./node_modules
COPY --from=deps /usr/bin/dumb-init /usr/bin/dumb-init

COPY src ./src
COPY openapi.yaml ./openapi.yaml
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

VOLUME ["/data"]

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/health/ready || exit 1

USER root
ENTRYPOINT ["dumb-init", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "src/index.js"]
