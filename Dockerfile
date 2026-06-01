FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy all source including prisma/schema.prisma
COPY . .

# Generate Prisma client and build Next.js
RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# At startup: create/migrate tables then start Next.js
CMD sh -c "npx prisma db push --schema=/app/prisma/schema.prisma --skip-generate && npx next start -p ${PORT:-3000}"
