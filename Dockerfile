FROM node:20-slim

# Prisma query engine requires OpenSSL at runtime
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy schema first so postinstall (prisma generate) can find it
COPY prisma ./prisma/
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Copy schema to /app/schema/ — a path the Railway volume never mounts.
# The volume is mounted at /app/prisma/ and would overwrite schema.prisma
# there at runtime, so we keep a build-time copy outside that path.
RUN mkdir -p /app/schema && cp /app/prisma/schema.prisma /app/schema/schema.prisma

ENV NODE_ENV=production
EXPOSE 3000

# Railway overrides CMD with npm start, so the start script does the work.
# DATABASE_URL points to /app/prisma/prod.db which lives inside the volume.
CMD ["npm", "start"]
