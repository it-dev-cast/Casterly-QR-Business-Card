# CardDesk: production image. It stores nothing on disk: employees come from nexusAuth's API and
# CardDesk's own settings live in its schema in nexusAuth's PostgreSQL database.
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public

ENV HOST=0.0.0.0 \
    PORT=4300 \
    TRUST_PROXY=true
EXPOSE 4300

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4300)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
