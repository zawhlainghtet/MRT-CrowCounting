# Single-stage build for HeadCounter Server
FROM node:21-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (skip postinstall to avoid vitest)
RUN npm ci --ignore-scripts

# Copy source code
COPY tsconfig.server.json ./
COPY src/ ./src/

# Build server-only TypeScript
RUN npx tsc -p tsconfig.server.json && cp src/server/dashboard.html dist/server/

# Remove dev dependencies and source after build
RUN npm prune --omit=dev && rm -rf src tsconfig.server.json

# Verify sql.js exists
RUN ls node_modules/sql.js/dist/ && echo "sql.js OK"

# Copy default config to production path
RUN mkdir -p /usr/local/headcounter/config
COPY resources/default-config.json /usr/local/headcounter/config/config.json

# Create non-root user
RUN addgroup -g 1001 -S headcounter && \
    adduser -S headcounter -u 1001 -G headcounter

# Create data directory
RUN mkdir -p /app/data && chown -R headcounter:headcounter /app /usr/local/headcounter

# Switch to non-root user
USER headcounter

# Expose server port
EXPOSE 3456

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3456/api/status || exit 1

# Environment variables
ENV NODE_ENV=production
ENV PORT=3456

# Default command
CMD ["node", "dist/server-entry.js", "server", "start"]
