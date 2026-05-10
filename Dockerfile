FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    g++ \
    make \
    openssh-client \
    python3 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /home/node/.ssh \
  && chown -R node:node /home/node/.ssh \
  && chmod 700 /home/node/.ssh

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

USER node

CMD ["npm", "start"]
