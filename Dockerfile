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

EXPOSE 3000

USER node

CMD ["npm", "start"]
