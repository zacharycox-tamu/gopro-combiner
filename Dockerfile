# ============================================================================
# Complete GoPro Video Processor - All-in-One Dockerfile
# Includes: React Frontend Build + Node.js Backend + FFmpeg
# ============================================================================

# ============================================================================
# Stage 1: Build React Frontend
# ============================================================================
FROM node:18-alpine AS frontend-build

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install frontend dependencies
RUN npm install && npm cache clean --force

# Copy frontend source code
COPY frontend/ ./

# Build the React application for production
RUN npm run build

# ============================================================================
# Stage 2: Setup Backend Dependencies
# ============================================================================
FROM node:18-alpine AS backend-deps

WORKDIR /app

# Copy backend package files
COPY package*.json ./

# Install backend dependencies
RUN npm install --omit=dev && npm cache clean --force

# ============================================================================
# Stage 3: Final Production Image
# ============================================================================
FROM node:18-alpine AS production

# Install FFmpeg and runtime dependencies
RUN apk add --no-cache \
    ffmpeg \
    ffmpeg-libs \
    dumb-init \
    curl \
    bash \
    && rm -rf /var/cache/apk/*

# Verify FFmpeg installation
RUN ffmpeg -version

# Create app user for security (non-root)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S gopro -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy backend dependencies from build stage
COPY --from=backend-deps --chown=gopro:nodejs /app/node_modules ./node_modules

# Copy backend application code
COPY --chown=gopro:nodejs package*.json ./
COPY --chown=gopro:nodejs server.js ./

# Copy built frontend from frontend-build stage
COPY --from=frontend-build --chown=gopro:nodejs /app/frontend/build ./public

# Create required directories for video processing
RUN mkdir -p /app/uploads /app/outputs && \
    chown -R gopro:nodejs /app

# Create healthcheck script
RUN printf '#!/bin/sh\ncurl -f http://localhost:${PORT:-3000}/health || exit 1\n' > /usr/local/bin/healthcheck && \
    chmod +x /usr/local/bin/healthcheck

# Set environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_DIR=/app/uploads \
    OUTPUT_DIR=/app/outputs \
    REDIS_URL=redis://redis:6379 \
    MAX_FILE_SIZE=10737418240 \
    FILE_RETENTION_HOURS=24

# Expose port
EXPOSE 3000

# Health check for Kubernetes/Docker
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD /usr/local/bin/healthcheck

# Switch to non-root user for security
USER gopro

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "server.js"]
