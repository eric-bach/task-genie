"""Azure DevOps tools for the Strands agent."""

import json
from strands import tool
from services.azure_service import AzureService

azure_service = AzureService()

@tool
async def get_work_item(work_item_id: int, team_project: str) -> str:
    """Retrieves an Azure DevOps work item by its ID.

    Args:
        work_item_id: The ID of the work item to retrieve.
        team_project: The team project name.

    Returns:
        JSON string of the work item data.
    """
    try:
        work_item = await azure_service.get_work_item(work_item_id, team_project)
        return json.dumps(work_item)
    except Exception as e:
        return f"Error getting work item: {str(e)}"

@tool
async def add_comment(work_item: dict, comment: str) -> str:
    """Adds a comment to an Azure DevOps work item.

    Args:
        work_item: The work item object to add the comment to.
        comment: The comment text to add including any knowledge base sources used.

    Returns:
        Success message or error description.
    """
    try:
        result = await azure_service.add_comment(work_item, comment)
        return f"Comment added successfully: {result}"
    except Exception as e:
        return f"Error adding comment: {str(e)}"

@tool
async def add_tag(team_project: str, work_item_id: int, tag: str) -> str:
    """Adds a tag to an Azure DevOps work item.

    Args:
        team_project: The team project name.
        work_item_id: The ID of the work item.
        tag: The tag to add.

    Returns:
        Success message or error description.
    """
    try:
        result = await azure_service.add_tag(team_project, work_item_id, tag)
        return f"Tag added successfully: {result}"
    except Exception as e:
        return f"Error adding tag: {str(e)}"

@tool
async def get_child_work_items(work_item: dict) -> str:
    """Retrieves child work items associated with a specific work item.

    Args:
        work_item: The parent work item to fetch children for.

    Returns:
        JSON string of the child work items.
    """
    try:
        child_work_items = await azure_service.get_child_work_items(work_item)
        return json.dumps(child_work_items)
    except Exception as e:
        return f"Error getting child work items: {str(e)}"

@tool
async def create_child_work_items(work_item: dict, child_work_items: list) -> str:
    """Creates multiple child work items for a work item in Azure DevOps.

    Args:
        work_item: The parent work item to create children for.
        child_work_items: Array of child work items to create.

    Returns:
        Success message or error description.
    """
    try:
        await azure_service.create_child_work_items(work_item, child_work_items)
        return "Child work items created successfully."
    except Exception as e:
        return f"Error creating child work items: {str(e)}"
