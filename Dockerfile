FROM node:22-slim AS assets
WORKDIR /app
COPY . .
RUN node scripts/build.mjs

FROM node:22-slim
WORKDIR /app
ENV HOST=0.0.0.0 PORT=8011
COPY --from=assets /app/dist ./dist
COPY --from=assets /app/scripts/serve.mjs ./scripts/serve.mjs
USER node
EXPOSE 8011
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8011/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "scripts/serve.mjs"]
