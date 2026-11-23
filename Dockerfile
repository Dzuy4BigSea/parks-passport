# Debian slim (glibc) so better-sqlite3 and sharp install from prebuilt binaries.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# Fewer glibc malloc arenas: keeps sharp's memory use in check (sharp's recommendation on glibc).
ENV MALLOC_ARENA_MAX=2
COPY package*.json ./
# --ignore-scripts: native deps ship prebuilt binaries; skip node-gyp (no Python in the image).
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts && npm cache clean --force
COPY . .
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
