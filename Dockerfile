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
RUN openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"

# Prune dependencies to production-only
RUN npm prune --production

# Use another Node.js Slim image for the final stage
FROM node:24.0.1-slim AS runner

# Set the working directory
WORKDIR /app

# Copy the built app, server script, certs, and production node_modules from the builder stage
COPY --from=builder /app/build build/
COPY --from=builder /app/server.js server.js
COPY --from=builder /app/key.pem key.pem
COPY --from=builder /app/cert.pem cert.pem
COPY --from=builder /app/node_modules node_modules/
COPY package.json .

# Set correct permissions for SSL certificates
RUN chmod 644 cert.pem && chmod 600 key.pem

# Expose the port the app runs on
EXPOSE 5000

# Set the environment to production
ENV NODE_ENV=production

# Specify the command to run the app with HTTPS
CMD ["node", "server.js"]