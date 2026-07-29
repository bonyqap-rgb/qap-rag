# Stage 1: Build TypeScript codebase
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package descriptors and lockfile
COPY package*.json ./

# Install all dependencies (including devDependencies for compilation)
RUN npm ci

# Copy tsconfig and source code
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to JavaScript
RUN npm run build

# Remove development dependencies to keep the image slim
RUN npm prune --production

# Stage 2: Final lightweight production image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Copy only production dependencies and built files
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create storage directory for uploaded documents and set correct permissions
RUN mkdir -p storage/documents && chown -R node:node /app

# Use non-root node user for runtime security
USER node

EXPOSE 3001

# Start the compiled ES Module server directly
CMD ["node", "dist/index.js"]
