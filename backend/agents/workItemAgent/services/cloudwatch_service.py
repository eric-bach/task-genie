import boto3
import logging
from typing import Literal

logger = logging.getLogger(__name__)

WorkItemType = Literal["Product Backlog Item", "User Story", "Epic", "Feature", "Task"]

class CloudWatchService:
    """Service class for creating CloudWatch metrics."""

    def __init__(self):
        self.cloudwatch_client = boto3.client("cloudwatch")
        self.namespace = "Azure DevOps"

    async def create_metric(self, metric_name: str, value: float, dimensions: list, unit: str = "Count"):
        """Creates a CloudWatch metric."""
        try:
            response = self.cloudwatch_client.put_metric_data(
                Namespace=self.namespace,
                MetricData=[
                    {
                        "MetricName": metric_name,
                        "Dimensions": dimensions,
                        "Value": value,
                        "Unit": unit,
                    }
                ],
            )
            logger.info(f"📈 {metric_name} metric created", extra={"response": response})
        except Exception as e:
            logger.error(f"Error creating custom metric: {e}")

    async def create_incomplete_work_item_metric(self, work_item_type: WorkItemType):
        """Creates a CloudWatch metric for an incomplete work item."""
        await self.create_metric(
            metric_name="IncompleteWorkItems",
            value=1,
            dimensions=[{"Name": "WorkItemType", "Value": work_item_type}],
        )

    async def create_work_item_generated_metric(self, value: int, work_item_type: str):
        """Creates a CloudWatch metric for generated work items."""
        await self.create_metric(
            metric_name=f"{work_item_type.replace(' ', '')}Generated",
            value=value,
            dimensions=[{"Name": "WorkItemType", "Value": work_item_type}],
        )

    async def create_work_item_updated_metric(self, work_item_type: WorkItemType):
        """Creates a CloudWatch metric for an updated work item."""
        await self.create_metric(
            metric_name=f"{work_item_type.replace(' ', '')}Updated",
            value=1,
            dimensions=[{"Name": "WorkItemType", "Value": work_item_type}],
        )
