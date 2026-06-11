FROM node:20-bookworm-slim

# System deps: OpenSSL for Prisma + Playwright/Chromium
# libasound2t64 is the Debian Bookworm (node:20-slim) name for libasound2
RUN apt-get update -y && apt-get install -y \
    openssl \
    ca-certificates \
    libgtk-3-0 \
    libasound2t64 \
    libxdamage1 \
    libgbm1 \
    libxkbcommon0 \
    libpango-1.0-0 \
    libcairo2 \
    libxcomposite1 \
    libxrandr2 \
    libxi6 \
    libxtst6 \
    fonts-liberation \
    libx11-xcb1 \
    libxshmfence1 \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxfixes3 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy schema first so postinstall (prisma generate) can find it
COPY prisma ./prisma/
COPY package*.json ./
RUN npm ci

# Install Playwright Chromium browser (used for HTML→PNG export)
RUN npx playwright install chromium --with-deps || npx playwright install chromium

COPY . .

# Increase Node memory for Next.js build on Railway
RUN NODE_OPTIONS="--max-old-space-size=2048" npm run build

# Copy schema to /app/schema/ — a path the Railway volume never mounts.
RUN mkdir -p /app/schema && cp /app/prisma/schema.prisma /app/schema/schema.prisma

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
EXPOSE 3000

CMD ["npm", "start"]
