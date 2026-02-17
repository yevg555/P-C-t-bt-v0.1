# =============================================================================
# MULTI-STAGE DOCKERFILE for PolyMarket Copy Trading Bot
# =============================================================================
# Stage 1 (build):  Install ALL deps + compile TypeScript
# Stage 2 (production): Lean image with only production deps + compiled JS
# =============================================================================

# ---------------------
# STAGE 1: BUILD
# ---------------------
FROM node:20-slim AS build

# Install build tools required by better-sqlite3 (native addon)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package manifests first (layer cache optimization)
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies for tsc)
RUN npm ci

# Copy source code and config
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript -> dist/
RUN npm run build

# Copy the dashboard HTML into dist/ so it sits alongside the compiled JS.
# The server resolves index.html via __dirname which points to dist/dashboard/
# after compilation, but tsc does not copy non-TS files.
RUN cp src/dashboard/index.html dist/dashboard/index.html

# ---------------------
# STAGE 2: PRODUCTION
# ---------------------
FROM node:20-slim AS production

# Install only the minimal native build tools needed to install better-sqlite3
# in production (the prebuilt binary often works, but we keep build tools as
# a fallback to guarantee compilation succeeds on any arch).
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Create a non-root user for security
RUN groupadd --gid 1001 botuser && \
    useradd --uid 1001 --gid botuser --shell /bin/bash --create-home botuser

WORKDIR /app

# Copy package manifests
COPY package.json package-lock.json ./

# Install production dependencies only (includes better-sqlite3)
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copy compiled JavaScript from build stage
COPY --from=build /app/dist/ ./dist/

# Create the data directory for SQLite persistence (will be volume-mounted)
RUN mkdir -p /app/data && chown -R botuser:botuser /app/data

# Set ownership of the entire app directory
RUN chown -R botuser:botuser /app

# Switch to non-root user
USER botuser

# Expose the dashboard port
EXPOSE 3456

# Health check: hit the dashboard root endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const http = require('http'); const req = http.get('http://localhost:3456/', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.setTimeout(3000, () => { req.destroy(); process.exit(1); });"

# Default command: run the compiled bot
CMD ["node", "dist/index.js"]
