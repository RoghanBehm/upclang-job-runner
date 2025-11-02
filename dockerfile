FROM node:20-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates bash tar gzip \
    build-essential cmake clang clang-tidy bear git python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN chmod +x bash/run_tidy.sh

CMD ["node", "index.js"]

