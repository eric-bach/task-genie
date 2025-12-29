FROM node:20-slim

# This Dockerfile assumes the build context is the repository root (e.g. c:\Projects\task-genie)
# Build with: docker build -f backend/agents/workItemAgent/Dockerfile -t workItemAgent .

WORKDIR /app

# Copy the backend directory to include the agent and its sibling dependencies (evaluate-work-item)
COPY . /app/backend

# Switch to the agent directory
WORKDIR /app/backend/agents/workItemAgent

# Install dependencies
RUN npm install

# Run the agent using tsx to handle TypeScript and relative imports execution
CMD ["npx", "tsx", "agent.ts"]
