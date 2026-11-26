ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node src ./src
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
