import os
import boto3
import httpx
import json
import logging
import base64
import urllib.parse
from typing import Optional, Dict, Any, List, Literal
from datetime import datetime

logger = logging.getLogger(__name__)

ADOProcessTemplate = Literal["Scrum", "Agile", "Basic", "CMMI"]

class AzureService:
    """Service class for interacting with Azure DevOps APIs."""

    def __init__(self):
        self.azure_devops_organization = os.environ.get("AZURE_DEVOPS_ORGANIZATION")
        if not self.azure_devops_organization:
            raise ValueError("AZURE_DEVOPS_ORGANIZATION environment variable is required")

        self.secrets_client = boto3.client("secretsmanager")
        self._credentials: Optional[Dict[str, str]] = None
        self._access_token: Optional[str] = None
        self._token_expires_at: float = 0

    async def _get_azure_devops_credentials(self) -> Dict[str, str]:
        """Retrieves Azure DevOps credentials from AWS Secrets Manager."""
        if self._credentials:
            return self._credentials

        secret_name = os.environ.get("AZURE_DEVOPS_CREDENTIALS_SECRET_NAME")
        if not secret_name:
            raise ValueError("AZURE_DEVOPS_CREDENTIALS_SECRET_NAME environment variable is required")

        response = self.secrets_client.get_secret_value(SecretId=secret_name)
        self._credentials = json.loads(response["SecretString"])
        return self._credentials

    async def _get_access_token(self) -> str:
        """Retrieves and caches an Azure AD access token for API authentication."""
        now = datetime.now().timestamp() * 1000

        if self._access_token and now < self._token_expires_at - 60000:
            return self._access_token

        credentials = await self._get_azure_devops_credentials()
        tenant_id = credentials["tenantId"]
        client_id = credentials["clientId"]
        client_secret = credentials["clientSecret"]
        scope = credentials["scope"]

        url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"

        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "scope": scope,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            response.raise_for_status()
            token_response = response.json()

        self._access_token = token_response["access_token"]
        self._token_expires_at = now + token_response["expires_in"] * 1000

        logger.debug(f"Refreshed Azure AD token, expires in {token_response['expires_in']}s")
        return self._access_token

    async def get_work_item(self, work_item_id: int, team_project: str) -> Dict[str, Any]:
        """Retrieves an Azure DevOps work item by its ID."""
        logger.info(f"⚙️ Fetching work item {work_item_id}")

        url = f"https://{self.azure_devops_organization}.visualstudio.com/{team_project}/_apis/wit/workItems/{work_item_id}?api-version=7.1"

        logger.debug(f"Getting work item {work_item_id} from {url}")

        async with httpx.AsyncClient() as client:
            response = await client.get(
                url,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {await self._get_access_token()}",
                },
            )
            response.raise_for_status()
            logger.debug(f"Work item {work_item_id} retrieved successfully")
            return response.json()

    async def add_comment(self, work_item: Dict[str, Any], comment: str) -> str:
        """Adds a comment to an Azure DevOps work item."""
        mention_user = work_item.get("originalChangedBy") or work_item.get("changedBy", "")
        work_item_id = work_item["workItemId"]
        team_project = work_item["teamProject"]

        logger.info(f"⚙️ Adding comment to work item {work_item_id}")

        url = f"https://{self.azure_devops_organization}.visualstudio.com/{team_project}/_apis/wit/workItems/{work_item_id}/comments?api-version=7.1-preview.4"

        body = {
            "text": f'<div><a href="#" data-vss-mention="version:2.0,{{user id}}">@{mention_user}</a> {comment}</div>'
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                json=body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {await self._get_access_token()}",
                },
            )
            response.raise_for_status()
            data = response.json()
            logger.info(f"Added comment to work item {data.get('id')}")
            return json.dumps(body)

    async def add_tag(self, team_project: str, work_item_id: int, tag: str) -> str:
        """Adds a tag to an Azure DevOps work item."""
        logger.info(f"⚙️ Adding tag '{tag}' to work item {work_item_id}")

        url = f"https://{self.azure_devops_organization}.visualstudio.com/{team_project}/_apis/wit/workItems/{work_item_id}?api-version=7.1"

        fields = [{"op": "add", "path": "/fields/System.Tags", "value": tag}]

        async with httpx.AsyncClient() as client:
            response = await client.patch(
                url,
                json=fields,
                headers={
                    "Content-Type": "application/json-patch+json",
                    "Authorization": f"Bearer {await self._get_access_token()}",
                },
            )
            response.raise_for_status()
            data = response.json()
            logger.info(f"Added tag to work item {data.get('id')}")
            return json.dumps(fields)

    async def get_project_process_template(self, team_project: str) -> Optional[ADOProcessTemplate]:
        """
        Retrieves the process template for an Azure DevOps project.
        Uses the project capabilities API to determine if the project uses Scrum, Agile, Basic, or CMMI process.
        """
        logger.debug(f"⚙️ Fetching process template for project {team_project}")

        try:
            encoded_project = urllib.parse.quote(team_project, safe="")
            url = f"https://{self.azure_devops_organization}.visualstudio.com/_apis/projects/{encoded_project}?includeCapabilities=true&api-version=7.1"

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    url,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {await self._get_access_token()}",
                    },
                )

                if not response.is_success:
                    logger.warning(
                        f"Failed to fetch project process template: {response.status_code} {response.reason_phrase}"
                    )
                    return None

                project_data = response.json()
                template_name = project_data.get("capabilities", {}).get("processTemplate", {}).get("templateName")

                if template_name:
                    logger.info(f"📋 Project {team_project} uses {template_name} process template")
                    return self._normalize_process_template(template_name)

                logger.warning(f"Process template not found in project capabilities for {team_project}")
                return None

        except Exception as e:
            logger.error(f"Error fetching project process template: {e}")
            return None

    def _normalize_process_template(self, template_name: str) -> Optional[ADOProcessTemplate]:
        """
        Normalizes the process template name from ADO API to our expected type.
        Handles variations like "Scrum", "Agile", "Microsoft Visual Studio Scrum", etc.
        """
        lower_name = template_name.lower()

        if "scrum" in lower_name:
            return "Scrum"
        if "agile" in lower_name:
            return "Agile"
        if "basic" in lower_name:
            return "Basic"
        if "cmmi" in lower_name:
            return "CMMI"

        logger.warning(f"Unknown process template: {template_name}, defaulting to None")
        return None

    async def get_child_work_items(self, work_item: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Retrieves child work items associated with a specific work item based on Azure DevOps hierarchy.
        - Epic -> Features
        - Feature -> User Stories (Agile) or Product Backlog Items (Scrum)
        - User Story/Product Backlog Item -> Tasks
        """
        work_item_id = work_item["workItemId"]
        team_project = work_item["teamProject"]
        work_item_type = work_item.get("workItemType", "")
        process_template = work_item.get("processTemplate", "")

        expected_child_type = self._get_expected_child_work_item_type(work_item, plural=False)
        expected_child_type_plural = self._get_expected_child_work_item_type(work_item, plural=True)

        logger.info(
            f"⚙️ Fetching child {expected_child_type_plural} in {work_item_type} {work_item_id}"
        )

        try:
            child_items: List[Dict[str, Any]] = []

            # Early return for invalid work item IDs
            if work_item_id <= 0:
                logger.info(f"No existing child {expected_child_type_plural} in {work_item_type} {work_item_id}")
                return child_items

            # Get work item details including relations
            url = f"https://{self.azure_devops_organization}.visualstudio.com/{team_project}/_apis/wit/workItems/{work_item_id}?$expand=relations&api-version=7.1"

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    url,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {await self._get_access_token()}",
                    },
                )

                if not response.is_success:
                    error_text = response.text
                    logger.error(
                        f"Failed to get work item details: {response.status_code} {response.reason_phrase} - {error_text}"
                    )
                    raise Exception(
                        f"Failed to get work item details: {response.status_code} {response.reason_phrase} - {error_text}"
                    )

                logger.debug(f"Work item {work_item_id} retrieved successfully")

                parent_item = response.json()

            # Extract child work item IDs from hierarchy relations
            relations = parent_item.get("relations", []) or []
            child_ids = []
            for relation in relations:
                if relation.get("rel") == "System.LinkTypes.Hierarchy-Forward" and relation.get("url"):
                    # Extract work item ID from URL
                    child_id = int(relation["url"].split("/")[-1])
                    child_ids.append(child_id)

            # If there are no child IDs, return empty array early
            if not child_ids:
                logger.info(f"No existing child {expected_child_type_plural} in {work_item_type} {work_item_id}")
                return child_items

            # Fetch child work items using batch API with specific fields
            batch_url = f"https://{self.azure_devops_organization}.visualstudio.com/{team_project}/_apis/wit/workitemsbatch?api-version=7.1"

            batch_body = {
                "ids": child_ids,
                "fields": [
                    "System.Id",
                    "System.Title",
                    "System.Description",
                    "System.WorkItemType",
                    "System.State",
                    "System.Tags",
                    "System.AreaPath",
                    "System.IterationPath",
                    "System.ChangedBy",
                    # User Story specific fields
                    "Microsoft.VSTS.Common.AcceptanceCriteria",
                    "Custom.Importance",
                    # Epic specific fields
                    "Custom.SuccessCriteria",
                    "Custom.Objective",
                    "Custom.AddressedRisks",
                    "Custom.PursueRisk",
                    "Custom.MostRecentUpdate",
                    "Custom.OutstandingActionItems",
                    # Feature specific fields
                    "Custom.BusinessDeliverable",
                    # Common custom fields
                    "Custom.AMAValueArea",
                    "Custom.BusinessUnit",
                    "Custom.System",
                    "Custom.ReleaseNotes",
                    "Custom.QANotes",
                ],
            }

            logger.debug(f"Fetching child work items with batch API: {batch_body}")

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    batch_url,
                    json=batch_body,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {await self._get_access_token()}",
                    },
                )

                if not response.is_success:
                    raise Exception(
                        f"Failed to get child {expected_child_type_plural} in {team_project} {work_item_id}"
                    )

                child_items_data = response.json()

            if child_items_data.get("value") and isinstance(child_items_data["value"], list):
                for child_item in child_items_data["value"]:
                    fields = child_item.get("fields", {})
                    child_work_item_type = fields.get("System.WorkItemType", "")

                    # Filter by expected child type (but be flexible to handle different configurations)
                    if expected_child_type and child_work_item_type != expected_child_type:
                        logger.warning(
                            f"Unexpected child work item type: expected {expected_child_type}, found {child_work_item_type}"
                        )
                        # Continue processing rather than skipping, in case of custom configurations

                    # Ignore work items that are closed/resolved/removed
                    state = fields.get("System.State", "")
                    if state in ["Removed", "Closed", "Resolved"]:
                        continue

                    # Build the work item dict with proper structure
                    base_work_item = {
                        "workItemId": child_item.get("id"),
                        "rev": child_item.get("rev", 0),
                        "title": fields.get("System.Title", ""),
                        "description": fields.get("System.Description", ""),
                        "state": state,
                        "tags": fields.get("System.Tags", ""),
                        "areaPath": fields.get("System.AreaPath", ""),
                        "iterationPath": fields.get("System.IterationPath", ""),
                        "amaValueArea": fields.get("Custom.AMAValueArea", ""),
                        "businessUnit": fields.get("Custom.BusinessUnit", ""),
                        "system": fields.get("Custom.System", ""),
                        "teamProject": team_project,
                        "processTemplate": process_template,
                        "changedBy": fields.get("System.ChangedBy", {}).get("displayName", "") if isinstance(fields.get("System.ChangedBy"), dict) else "",
                    }

                    # Add type-specific fields
                    if child_work_item_type == "Epic":
                        base_work_item.update({
                            "workItemType": 'Epic',
                            "successCriteria": fields.get("Custom.SuccessCriteria", ""),
                            "objective": fields.get("Custom.Objective", ""),
                            "addressedRisks": fields.get("Custom.AddressedRisks", ""),
                            "pursueRisk": fields.get("Custom.PursueRisk", ""),
                            "mostRecentUpdate": fields.get("Custom.MostRecentUpdate", ""),
                            "outstandingActionItems": fields.get("Custom.OutstandingActionItems", ""),
                        })
                    elif child_work_item_type == "Feature":
                        base_work_item.update({
                            "workItemType": 'Feature',
                            "successCriteria": fields.get("Custom.SuccessCriteria", ""),
                            "businessDeliverable": fields.get("Custom.BusinessDeliverable", ""),
                        })
                    elif child_work_item_type == "Product Backlog Item":
                        base_work_item.update({
                            "workItemType": 'Product Backlog Item',
                            "acceptanceCriteria": fields.get("Microsoft.VSTS.Common.AcceptanceCriteria", ""),
                            "releaseNotes": fields.get("Custom.ReleaseNotes", ""),
                            "qaNotes": fields.get("Custom.QANotes", ""),
                        })
                    elif child_work_item_type == "User Story":
                        base_work_item.update({
                            "workItemType": 'User Story',
                            "acceptanceCriteria": fields.get("Microsoft.VSTS.Common.AcceptanceCriteria", ""),
                            "importance": fields.get("Custom.Importance", ""),
                        })
                    elif child_work_item_type == "Task":
                        base_work_item.update({
                            "workItemType": 'Task',
                        })

                    child_items.append(base_work_item)

            logger.info(
                f"📋 Found {len(child_items)} child {expected_child_type_plural} in {work_item_type} {work_item_id}"
            )

            return child_items

        except Exception as e:
            logger.error(
                f"Failed to fetch child {expected_child_type_plural} in {work_item_type} {work_item_id}: {e}"
            )
            raise

    async def create_child_work_items(
        self, work_item: Dict[str, Any], child_work_items: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Creates multiple child work items for a work item in Azure DevOps."""
        child_work_item_type = self._get_expected_child_work_item_type(work_item, plural=False) or "Task"
        child_type_plural = self._get_expected_child_work_item_type(work_item, plural=True)

        logger.info(
            f"⚙️ Creating {len(child_work_items)} {child_type_plural} for {work_item.get('workItemType')} {work_item.get('workItemId')}"
        )

        created_items = []
        total = len(child_work_items)

        for i, child in enumerate(child_work_items):
            created_item = await self._create_child_work_item(work_item, child, i, total)
            created_items.append(created_item)

            # Set the workItemId on the child work item (like TypeScript version does)
            child["workItemId"] = created_item.get("id")

        logger.info(
            f"✅ All {len(child_work_items)} {child_type_plural} successfully created for {work_item.get('workItemType')} {work_item.get('workItemId')}"
        )

        return created_items

    async def _create_child_work_item(
        self, work_item: Dict[str, Any], child_work_item: Dict[str, Any], index: int, total: int
    ) -> Dict[str, Any]:
        """
        Creates a single child work item in Azure DevOps and links it to the parent work item.
        The type of child work item created depends on the parent type and process template.
        """
        team_project = work_item["teamProject"]
        child_work_item_type = self._get_expected_child_work_item_type(work_item, plural=False) or "Task"

        # Build the patch document with common fields
        operations = [
            {"op": "add", "path": "/fields/System.Title", "value": child_work_item.get("title", "")},
            {"op": "add", "path": "/fields/System.Description", "value": child_work_item.get("description", "")},
            {"op": "add", "path": "/fields/System.AreaPath", "value": work_item.get("areaPath", "")},
            {"op": "add", "path": "/fields/System.IterationPath", "value": work_item.get("iterationPath", "")},
            {"op": "add", "path": "/fields/System.WorkItemType", "value": child_work_item_type},
            {"op": "add", "path": "/fields/System.Tags", "value": "Task Genie"},
        ]

        # Add work item type-specific fields
        if child_work_item_type == "User Story":
            operations.extend([
                {"op": "add", "path": "/fields/Microsoft.VSTS.Common.AcceptanceCriteria", "value": child_work_item.get("acceptanceCriteria", "")},
                {"op": "add", "path": "/fields/Custom.AMAValueArea", "value": work_item.get("amaValueArea", "")},
                {"op": "add", "path": "/fields/Custom.BusinessUnit", "value": work_item.get("businessUnit", "")},
                {"op": "add", "path": "/fields/Custom.System", "value": work_item.get("system", "")},
                {"op": "add", "path": "/fields/Custom.Importance", "value": child_work_item.get("importance", "")},
            ])
        elif child_work_item_type == "Product Backlog Item":
            operations.extend([
                {"op": "add", "path": "/fields/Microsoft.VSTS.Common.AcceptanceCriteria", "value": child_work_item.get("acceptanceCriteria", "")},
                {"op": "add", "path": "/fields/Custom.AMAValueArea", "value": work_item.get("amaValueArea", "")},
                {"op": "add", "path": "/fields/Custom.BusinessUnit", "value": work_item.get("businessUnit", "")},
                {"op": "add", "path": "/fields/Custom.System", "value": work_item.get("system", "")},
            ])
        elif child_work_item_type == "Feature":
            operations.extend([
                {"op": "add", "path": "/fields/Custom.BusinessUnit", "value": work_item.get("businessUnit", "")},
                {"op": "add", "path": "/fields/Custom.AMAValueArea", "value": work_item.get("amaValueArea", "")},
                {"op": "add", "path": "/fields/Custom.System", "value": work_item.get("system", "")},
                {"op": "add", "path": "/fields/Custom.SuccessCriteria", "value": child_work_item.get("successCriteria", "")},
                {"op": "add", "path": "/fields/Custom.BusinessDeliverable", "value": child_work_item.get("businessDeliverable", "")},
            ])

        # URL encode the work item type (spaces become %20)
        work_item_type_template = urllib.parse.quote(child_work_item_type, safe="")
        url = f"https://{self.azure_devops_organization}.visualstudio.com/{team_project}/_apis/wit/workitems/${work_item_type_template}?api-version=7.1"

        logger.debug(f"Creating {child_work_item_type} ({index + 1}/{total}): {child_work_item.get('title')}")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                json=operations,
                headers={
                    "Content-Type": "application/json-patch+json",
                    "Authorization": f"Bearer {await self._get_access_token()}",
                },
            )

            if not response.is_success:
                error_text = response.text
                logger.error(
                    f"Failed to create {child_work_item_type}: {response.status_code} {response.reason_phrase}. {error_text}"
                )
                raise Exception(
                    f"Failed to create {child_work_item_type}: {response.status_code} {response.reason_phrase}. {error_text}"
                )

            created_item = response.json()
            child_id = created_item.get("id")

            logger.info(
                f"Created {child_work_item_type} {child_id} for {work_item.get('workItemType')} {work_item.get('workItemId')}"
            )

            # Link the child to the parent
            await self.link_task(team_project, work_item["workItemId"], child_id)

            return created_item

    async def link_task(self, team_project: str, work_item_id: int, task_id: int) -> None:
        """
        Links a task to its parent work item in Azure DevOps.
        Creates a hierarchy-forward relationship from parent to child.
        """
        try:
            url = f"https://{self.azure_devops_organization}.visualstudio.com/{team_project}/_apis/wit/workitems/{work_item_id}?api-version=7.1"

            body = [
                {
                    "op": "add",
                    "path": "/relations/-",
                    "value": {
                        "rel": "System.LinkTypes.Hierarchy-Forward",
                        "url": f"https://{self.azure_devops_organization}.visualstudio.com/{team_project}/_apis/wit/workItems/{task_id}",
                        "attributes": {"comment": "Linking dependency"},
                    },
                }
            ]

            async with httpx.AsyncClient() as client:
                response = await client.patch(
                    url,
                    json=body,
                    headers={
                        "Content-Type": "application/json-patch+json",
                        "Authorization": f"Bearer {await self._get_access_token()}",
                    },
                )

                if response.is_success:
                    data = response.json()
                    logger.info(f"Linked task {data.get('id')} to work item {work_item_id}")
                else:
                    raise Exception(f"Failed to link task: {response.status_code} {response.reason_phrase}")

        except Exception as e:
            logger.error(f"Error linking task: {e}")

    def _get_expected_child_work_item_type(self, work_item: Dict[str, Any], plural: bool = False) -> Optional[str]:
        """
        Determines the expected child work item type based on parent type and process template.
        - Epic -> Features
        - Feature -> User Stories (Agile) or Product Backlog Items (Scrum)
        - User Story/Product Backlog Item -> Tasks
        """
        work_item_type = work_item.get("workItemType", "")
        process_template = work_item.get("processTemplate", "")

        if work_item_type == "Epic":
            return "Features" if plural else "Feature"
        elif work_item_type == "Feature":
            if process_template == "Scrum":
                return "Product Backlog Items" if plural else "Product Backlog Item"
            else:
                return "User Stories" if plural else "User Story"
        elif work_item_type in ["User Story", "Product Backlog Item"]:
            return "Tasks" if plural else "Task"

        return None

    async def fetch_image(self, image_url: str) -> Optional[str]:
        """Fetches an image from a URL and converts it to base64."""
        try:
            headers: Dict[str, str] = {}
            url = image_url

            # For Azure DevOps attachment URLs, add required query parameters and auth
            if "visualstudio.com" in image_url or "azure.com" in image_url:
                url = f"{image_url}&download=true&api-version=7.1"
                headers["Authorization"] = f"Bearer {await self._get_access_token()}"
            else:
                # For non-Azure DevOps images, add User-Agent header
                headers["User-Agent"] = "TaskGenie/1.0"

            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()

            base64_data = base64.b64encode(response.content).decode("utf-8")
            logger.debug(f"Successfully fetched image, size: {len(response.content) // 1024}KB")
            return base64_data

        except Exception as e:
            logger.warning(f"Error fetching image: {e}")
            return None
