FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:latest

WORKDIR /app

# Copy agent source code, shared services, and types (context is project root)
COPY backend/agents/workItemAgent ./backend/agents/workItemAgent
COPY backend/services ./backend/services
COPY backend/types ./backend/types

# Install services dependencies first (since agent depends on services)
WORKDIR /app/backend/services
RUN npm install

# Install agent dependencies
WORKDIR /app/backend/agents/workItemAgent
RUN npm install

# Build the bundled agent (esbuild bundles everything including services)
RUN npm run build

# Expose port
EXPOSE 8080

# Start the application
CMD ["npm", "start"]