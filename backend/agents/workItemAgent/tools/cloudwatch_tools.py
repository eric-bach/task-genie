"""CloudWatch tools for the Strands agent."""

from typing import Literal
from strands import tool
from services.cloudwatch_service import CloudWatchService

cloudwatch_service = CloudWatchService()

@tool
async def create_incomplete_work_item_metric(
    work_item_type: Literal["User Story", "Epic", "Feature", "Task"],
) -> str:
    """Creates a CloudWatch metric for an incomplete work item.

    Args:
        work_item_type: The type of work item (User Story, Epic, Feature, or Task).

    Returns:
        Success message or error description.
    """
    try:
        await cloudwatch_service.create_incomplete_work_item_metric(work_item_type)
        return f"Metric for incomplete {work_item_type} created."
    except Exception as e:
        return f"Error creating metric: {str(e)}"

@tool
async def create_work_item_generated_metric(value: int, work_item_type: str) -> str:
    """Creates a CloudWatch metric for generated work items.

    Args:
        value: The number of work items generated.
        work_item_type: The type of work item generated.

    Returns:
        Success message or error description.
    """
    try:
        await cloudwatch_service.create_work_item_generated_metric(value, work_item_type)
        return f"Metric for {value} {work_item_type}(s) generated created."
    except Exception as e:
        return f"Error creating metric: {str(e)}"

@tool
async def create_work_item_updated_metric(
    work_item_type: Literal["User Story", "Epic", "Feature", "Task"],
) -> str:
    """Creates a CloudWatch metric for an updated work item.

    Args:
        work_item_type: The type of work item (User Story, Epic, Feature, or Task).

    Returns:
        Success message or error description.
    """
    try:
        await cloudwatch_service.create_work_item_updated_metric(work_item_type)
        return f"Metric for updated {work_item_type} created."
    except Exception as e:
        return f"Error creating metric: {str(e)}"
