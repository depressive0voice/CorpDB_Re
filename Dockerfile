FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    HTTP_HOST=0.0.0.0 \
    CORPDB_STORAGE_DIR=/app/storage

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --chown=node:node src ./src

RUN mkdir -p /app/storage \
    && chown node:node /app/storage

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.HTTP_PORT || '3000') + '/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "src/index.js"]
