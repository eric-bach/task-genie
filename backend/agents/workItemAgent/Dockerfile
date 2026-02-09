FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

# All environment variables in one layer
ENV UV_COMPILE_BYTECODE=1 \
    UV_NO_PROGRESS=1 \
    PYTHONUNBUFFERED=1 \
    DOCKER_CONTAINER=1 \
    AWS_REGION=us-west-2 \
    AWS_DEFAULT_REGION=us-west-2 \
    OTEL_TRACES_SAMPLER=always_on \
    PATH="/app/.venv/bin:$PATH"

# Install dependencies
COPY backend/agents/workItemAgent/pyproject.toml backend/agents/workItemAgent/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# Signal that this is running in Docker for host binding logic
ENV DOCKER_CONTAINER=1

# Create non-root user
RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

# AgentCore HTTP endpoint
EXPOSE 8080

# Copy application code
COPY backend/agents/workItemAgent/ .

# Health check using the /ping endpoint provided by AgentCore SDK
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/ping || exit 1

CMD ["opentelemetry-instrument", "python", "-m", "src.agent"]
