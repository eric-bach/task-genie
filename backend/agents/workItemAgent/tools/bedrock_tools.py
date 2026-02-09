"""Bedrock tools for the Strands agent."""

import os
import json
from typing import Optional
from strands import tool
from services.bedrock_service import BedrockService

# Initialize the service
bedrock_service = BedrockService(
    region=os.environ.get("AWS_REGION", "us-west-2"),
    model_id=os.environ.get("AWS_BEDROCK_MODEL_ID", ""),
    knowledge_base_id=os.environ.get("AWS_BEDROCK_KNOWLEDGE_BASE_ID", ""),
    max_knowledge_documents=3,
    max_image_size=5,
    max_images=3,
    config_table_name=os.environ.get("CONFIG_TABLE_NAME", ""),
)

@tool
async def evaluate_work_item(work_item: dict) -> str:
    """Evaluates an Azure DevOps work item to determine if it is well-defined.

    Args:
        work_item: The work item to evaluate.

    Returns:
        JSON string with evaluation results.
    """
    try:
        tags = work_item.get("tags", [])
        if "Task Genie" in tags:
            return f"The {work_item['workItemType']} has already been previously evaluated by Task Genie. Please remove the `Task Genie` tag to re-evaluate this {work_item['workItemType']}."

        result = await bedrock_service.evaluate_work_item(work_item)
        return json.dumps({
            "pass": result.passed,
            "comment": result.comment,
            "sources": result.sources,
        })
    except Exception as e:
        return f"Error evaluating work item: {str(e)}"


@tool
async def generate_work_items(
    work_item: dict,
    existing_child_work_items: list,
    params: Optional[dict] = None,
) -> str:
    """Generates child work items for a given parent work item.

    Args:
        work_item: The parent work item.
        existing_child_work_items: A list of existing child work items to avoid duplicates.
        params: Optional inference parameters.

    Returns:
        JSON string with generated work items.
    """
    try:
        result = await bedrock_service.generate_work_items(
            work_item, existing_child_work_items, params
        )
        return json.dumps({
            "workItems": result.work_items,
            "documents": [
                {
                    "content": doc.content,
                    "source": doc.source,
                    "score": doc.score,
                }
                for doc in result.documents
            ],
        })
    except Exception as e:
        return f"Error generating work items: {str(e)}"
