# Use a Node.js Slim image for the builder stage
FROM node:24.0.1-slim AS builder

# Install OpenSSL for cert generation
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy the rest of the source files and build the SvelteKit app
COPY . .
RUN npm run build

# Generate self-signed SSL certificate
RUN mkdir -p /app/.certs && \
	openssl req -x509 -newkey rsa:4096 -keyout /app/.certs/key.pem -out /app/.certs/cert.pem -days 365 -nodes -subj "/CN=localhost"

# Prune dependencies to production-only
RUN npm prune --production

# Use another Node.js Slim image for the final stage
FROM node:24.0.1-slim AS runner

# Install Redis
RUN apt-get update && apt-get install -y redis-server && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy the built app, server script, certs, and production node_modules from the builder stage
COPY --from=builder /app/build build/
COPY --from=builder /app/scripts/dev/server.js scripts/dev/server.js
COPY --from=builder /app/scripts/dev/start.sh scripts/dev/start.sh
COPY --from=builder /app/.certs .certs/
COPY --from=builder /app/node_modules node_modules/
COPY package.json .

# Set correct permissions for SSL certificates
RUN chown node:node .certs/key.pem .certs/cert.pem && chmod 644 .certs/cert.pem && chmod 600 .certs/key.pem

# Create data directory for upload state and ensure node user can write to it
RUN mkdir -p /app/data && chown -R node:node /app && chmod -R 755 /app/data

# Expose the port the app runs on
EXPOSE 5000

# Set the environment to production
ENV NODE_ENV=production

# Specify the command to run the app with HTTPS and Redis
CMD ["sh", "scripts/dev/start.sh"]
