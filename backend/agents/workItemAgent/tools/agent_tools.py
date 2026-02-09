"""Agent tools for the Strands agent - finalize response and DynamoDB storage."""

import os
import boto3
import logging
from typing import Optional, Literal
from datetime import datetime
from strands import tool

logger = logging.getLogger(__name__)

dynamodb_client = boto3.resource("dynamodb")

def _extract_work_item_fields(work_item: dict) -> dict:
    """Extracts type-specific fields from a work item for DynamoDB storage."""
    return {
        "id": work_item.get("workItemId", 0),
        "title": work_item.get("title", ""),
        "description": work_item.get("description", ""),
        "workItemType": work_item.get("workItemType", ""),
        "acceptanceCriteria": work_item.get("acceptanceCriteria", ""),
    }

async def _save_response_to_dynamodb(
    execution_id: str,
    work_item: dict,
    child_work_items: list,
    outcome: str,
    comment: str,
) -> None:
    """Saves the execution result to DynamoDB."""
    table_name = os.environ.get("RESULTS_TABLE_NAME")
    if not table_name:
        logger.error("RESULTS_TABLE_NAME environment variable is not set")
        return

    passed = outcome == "decomposed"

    item = {
        "executionId": execution_id,
        "executionResult": "SUCCEEDED" if passed else "FAILED",
        "timestamp": datetime.utcnow().isoformat(),
        # Work Item
        "workItemId": work_item.get("workItemId", 0),
        "workItemStatus": passed,
        "workItemComment": comment,
        "workItem": _extract_work_item_fields(work_item),
        "workItemsCount": len(child_work_items) if child_work_items else 0,
        "workItemIds": [wi.get("workItemId", 0) for wi in (child_work_items or [])],
        "workItems": [_extract_work_item_fields(w) for w in (child_work_items or [])],
        "changedBy": work_item.get("changedBy", ""),
    }

    # Add optional ADO fields
    if work_item.get("areaPath"):
        item["areaPath"] = work_item["areaPath"]
    if work_item.get("iterationPath"):
        item["iterationPath"] = work_item["iterationPath"]
    if work_item.get("businessUnit"):
        item["businessUnit"] = work_item["businessUnit"]
    if work_item.get("system"):
        item["system"] = work_item["system"]

    try:
        table = dynamodb_client.Table(table_name)
        table.put_item(Item=item)
        logger.info(
            f"💾 Saved result to DynamoDB",
            extra={"workItemId": work_item.get("workItemId"), "executionId": execution_id},
        )
    except Exception as e:
        logger.error(
            f"🛑 Failed to save to DynamoDB",
            extra={"error": str(e), "workItemId": work_item.get("workItemId")},
        )

@tool
async def finalize_response(
    session_id: str,
    work_item: dict,
    outcome: Literal["decomposed", "feedback_provided", "skipped", "error"],
    summary: str,
    child_work_items: Optional[list] = None,
) -> dict:
    """Finalize the response after processing a work item. Provide a summary of what was accomplished.
    Use the sessionId provided in the request as the executionId.

    Args:
        session_id: The session ID from the request to use as executionId for DynamoDB storage.
        work_item: The parent work item that was processed.
        outcome: The outcome of processing the work item (decomposed, feedback_provided, skipped, error).
        summary: A brief summary of what was done.
        child_work_items: The child work items that were created (optional).

    Returns:
        Dictionary with workItemId, outcome, and response message.
    """
    work_item_id = work_item.get("workItemId", 0)
    work_item_title = work_item.get("title", "")
    work_item_type = work_item.get("workItemType", "Work Item")
    child_items_created = len(child_work_items) if child_work_items else 0

    response = ""

    if outcome == "decomposed":
        response = f'✅ Successfully decomposed {work_item_type} #{work_item_id} "{work_item_title}" into {child_items_created} child Tasks. {summary}'

        # Save to DynamoDB using sessionId as executionId
        await _save_response_to_dynamodb(
            session_id, work_item, child_work_items or [], outcome, response
        )

    elif outcome == "feedback_provided":
        response = f'📝 Provided feedback on {work_item_type} #{work_item_id} "{work_item_title}". {summary}'

    elif outcome == "skipped":
        response = f'⏭️ Skipped {work_item_type} #{work_item_id} "{work_item_title}". {summary}'

    elif outcome == "error":
        response = f'❌ Error processing {work_item_type} #{work_item_id} "{work_item_title}". {summary}'

    return {
        "workItemId": work_item_id,
        "outcome": outcome,
        "response": response,
    }
