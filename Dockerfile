FROM node:20-slim

# System deps: OpenSSL for Prisma + Playwright/Chromium dependencies
RUN apt-get update -y && apt-get install -y \
    openssl \
    libgtk-3-0 \
    libasound2 \
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
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy schema first so postinstall (prisma generate) can find it
COPY prisma ./prisma/
COPY package*.json ./
RUN npm ci

# Install Playwright Chromium browser (used for HTML→PNG export)
RUN npx playwright install chromium

COPY . .
RUN npm run build

# Copy schema to /app/schema/ — a path the Railway volume never mounts.
RUN mkdir -p /app/schema && cp /app/prisma/schema.prisma /app/schema/schema.prisma

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
EXPOSE 3000

CMD ["npm", "start"]
