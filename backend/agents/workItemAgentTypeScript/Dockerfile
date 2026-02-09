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

# NOTE: OpenTelemetry session tracing is not yet supported in the TypeScript SDKs
# - @strands-agents/sdk: See https://github.com/strands-agents/sdk-typescript/issues/69
# - bedrock-agentcore: Observability marked as "coming soon"
# The AWS ADOT auto-instrumentation only captures basic HTTP traces, not agent-level spans.
# For full observability with sessions/traces, consider using the Python SDK.

# Start the application (OTEL auto-instrumentation provides basic HTTP traces only)
CMD ["node", "--require", "@aws/aws-distro-opentelemetry-node-autoinstrumentation/register", "dist/agent.mjs"]