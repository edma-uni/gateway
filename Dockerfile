FROM node:22-alpine AS base
WORKDIR /usr/src/app

FROM base AS dependencies
COPY package*.json ./
RUN npm ci

# ---- Build Stage ----
FROM base AS builder
# Copy dependencies from the previous stage
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
# Copy source code
COPY . .
# Build the application
RUN npm run build

# ---- Production Stage ----
FROM base AS production
# Set production environment
ENV NODE_ENV=production
# Copy only the built application and production dependencies
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY --from=dependencies /usr/src/app/package*.json ./

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["node", "dist/main"]