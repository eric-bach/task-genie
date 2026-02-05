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

# Create non-root user
RUN useradd -m -u 1001 bedrock_agentcore
USER bedrock_agentcore

# Expose port
EXPOSE 8080

# Health check using the /ping endpoint provided by AgentCore SDK
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/ping || exit 1
    
# Start the application
ENV NODE_OPTIONS="--require @aws/aws-distro-opentelemetry-node-autoinstrumentation/register"
CMD ["npm", "start"]