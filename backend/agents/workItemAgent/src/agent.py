"""Work Item Agent - Python version with OpenTelemetry observability.

This agent processes Azure DevOps work items using Strands Agents SDK
with full OpenTelemetry tracing support for AWS Gen AI Observability.
"""
import os
import json
import logging
from typing import Any
from strands import Agent
from strands.models import BedrockModel
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from pydantic import BaseModel
from prompt import SYSTEM_PROMPT
from tools import (
    get_work_item,
    add_comment,
    add_tag,
    get_child_work_items,
    create_child_work_items,
    evaluate_work_item,
    generate_work_items,
    create_incomplete_work_item_metric,
    create_work_item_generated_metric,
    create_work_item_updated_metric,
    finalize_response,
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Validate required environment variables
REQUIRED_ENV_VARS = [
    "AWS_REGION",
    "AWS_BEDROCK_MODEL_ID",
    "AWS_BEDROCK_KNOWLEDGE_BASE_ID",
    "RESULTS_TABLE_NAME",
    "CONFIG_TABLE_NAME",
    "AZURE_DEVOPS_ORGANIZATION",
    "AZURE_DEVOPS_CREDENTIALS_SECRET_NAME",
]

for var in REQUIRED_ENV_VARS:
    if not os.environ.get(var):
        raise ValueError(f"{var} environment variable is required")

AWS_REGION = os.environ["AWS_REGION"]
AWS_BEDROCK_MODEL_ID = os.environ["AWS_BEDROCK_MODEL_ID"]

# Create the BedrockAgentCoreApp
app = BedrockAgentCoreApp()

# Create the agent with tools
agent = Agent(
    model=BedrockModel(
        region_name=AWS_REGION,
        model_id=AWS_BEDROCK_MODEL_ID,
    ),
    system_prompt=SYSTEM_PROMPT,
    tools=[
        evaluate_work_item,
        generate_work_items,
        finalize_response,
        get_work_item,
        add_comment,
        add_tag,
        get_child_work_items,
        create_child_work_items,
        create_incomplete_work_item_metric,
        create_work_item_generated_metric,
        create_work_item_updated_metric,
    ],
)

class WorkItemRequest(BaseModel):
    """Request schema for the agent."""

    work_item: dict
    params: dict
    session_id: str = ""

@app.entrypoint
async def process_request(request: dict, context: Any = None) -> dict:
    """Process an incoming work item request."""
    try:
        logger.info("▶️ Received request", extra={"request": request})

        # Extract from nested body structure (matches TypeScript version)
        body = request.get("body", request)
        work_item = body.get("workItem") or body.get("work_item")
        params = body.get("params", {})
        session_id = body.get("sessionId") or body.get("session_id", "")

        logger.info(
            "Parsed work item",
            extra={"workItem": work_item, "params": params, "sessionId": session_id},
        )

        # Invoke the agent
        prompt = f"""Here is the work item and params:

Work Item: {json.dumps(work_item, indent=2)}

Params: {json.dumps(params, indent=2)}

Session ID (use as executionId): {session_id or 'not-provided'}"""

        response = await agent.invoke_async(prompt, session_id=session_id)

        # Extract text from response
        message = response.message
        
        logger.info("✅ Agent response", extra={"response": message})

        return {"response": message}

    except Exception as e:
        logger.error("🛑 Error processing request", extra={"error": str(e)})
        raise

if __name__ == "__main__":
    logger.info("Starting Work Item Agent (Python)")
    app.run()
