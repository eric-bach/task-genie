import os
import boto3
import re
import json
import base64
import logging
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

MAX_OUTPUT_TOKENS = 10240

@dataclass
class BedrockKnowledgeDocument:
    """Represents a document retrieved from the knowledge base."""
    content: str
    content_length: int
    source: str
    score: float

@dataclass
class BedrockWorkItemEvaluationResponse:
    """Response from work item evaluation."""
    passed: bool
    comment: Optional[str]
    sources: List[str]

@dataclass
class BedrockWorkItemGenerationResponse:
    """Response from work item generation."""
    work_items: List[Dict[str, Any]]
    documents: List[BedrockKnowledgeDocument]

@dataclass
class BedrockInferenceParams:
    """Parameters for Bedrock inference."""
    prompt: Optional[str] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None
    refinement_instructions: Optional[str] = None
    generated_work_items: Optional[List[Dict[str, Any]]] = None

class BedrockService:
    """Service class for interacting with AWS Bedrock APIs."""

    def __init__(
        self,
        region: Optional[str] = None,
        model_id: Optional[str] = None,
        knowledge_base_id: Optional[str] = None,
        max_knowledge_documents: int = 3,
        max_image_size: int = 5,
        max_images: int = 3,
        config_table_name: Optional[str] = None,
    ):
        self.region = region or os.environ.get("AWS_REGION", "us-west-2")
        self.model_id = model_id or os.environ.get("AWS_BEDROCK_MODEL_ID", "")
        self.knowledge_base_id = knowledge_base_id or os.environ.get("AWS_BEDROCK_KNOWLEDGE_BASE_ID", "")
        self.max_knowledge_documents = max_knowledge_documents
        self.max_image_size = max_image_size
        self.max_images = max_images
        self.config_table_name = config_table_name or os.environ.get("CONFIG_TABLE_NAME", "")

        self.bedrock_agent_client = boto3.client("bedrock-agent-runtime", region_name=self.region)
        self.bedrock_runtime_client = boto3.client("bedrock-runtime", region_name=self.region)
        self.dynamodb_client = boto3.client("dynamodb", region_name=self.region)

    # ==================== Helper Functions ====================

    def _is_user_story(self, work_item: Dict[str, Any]) -> bool:
        """Check if work item is a User Story."""
        return work_item.get("workItemType", "") == "User Story"

    def _is_product_backlog_item(self, work_item: Dict[str, Any]) -> bool:
        """Check if work item is a Product Backlog Item."""
        return work_item.get("workItemType", "") == "Product Backlog Item"

    def _is_epic(self, work_item: Dict[str, Any]) -> bool:
        """Check if work item is an Epic."""
        return work_item.get("workItemType", "") == "Epic"

    def _is_feature(self, work_item: Dict[str, Any]) -> bool:
        """Check if work item is a Feature."""
        return work_item.get("workItemType", "") == "Feature"

    def _is_user_story_or_pbi(self, work_item: Dict[str, Any]) -> bool:
        """Check if work item is a User Story or Product Backlog Item."""
        return self._is_user_story(work_item) or self._is_product_backlog_item(work_item)

    def _is_epic_or_feature(self, work_item: Dict[str, Any]) -> bool:
        """Check if work item is an Epic or Feature."""
        return self._is_epic(work_item) or self._is_feature(work_item)

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

    # ==================== Knowledge Base Functions ====================

    def _build_work_item_evaluation_knowledge_query(self, work_item: Dict[str, Any]) -> str:
        """Constructs a knowledge base search query for work item evaluation."""
        criteria_field = ""
        if self._is_user_story_or_pbi(work_item) and work_item.get("acceptanceCriteria"):
            criteria_field = f"\n    - Acceptance Criteria: {work_item['acceptanceCriteria']}"
        elif self._is_epic_or_feature(work_item) and work_item.get("successCriteria"):
            criteria_field = f"\n    - Success Criteria: {work_item['successCriteria']}"

        criteria_type = "Acceptance Criteria" if self._is_user_story_or_pbi(work_item) else "Success Criteria"

        return f"""Find relevant information about the {work_item['workItemType']} process and guidelines that would help evaluate the following {work_item['workItemType']} is well-defined:
    - Title: {work_item['title']}
    - Description: {work_item['description']}
    - {criteria_type}: {criteria_field}"""

    def _build_work_item_breakdown_knowledge_query(self, work_item: Dict[str, Any]) -> str:
        """Constructs a knowledge base search query for work item breakdown and generation."""
        criteria_field = ""
        if self._is_user_story_or_pbi(work_item) and work_item.get("acceptanceCriteria"):
            criteria_field = f"\n    - Acceptance Criteria: {work_item['acceptanceCriteria']}"
        elif self._is_epic_or_feature(work_item) and work_item.get("successCriteria"):
            criteria_field = f"\n    - Success Criteria: {work_item['successCriteria']}"

        return f"""Find relevant information to help break down the {work_item['workItemType']} (such as technical details, application architecture, business context, etc.) for the following {work_item['workItemType']}:
    - Title: {work_item['title']}
    - Description: {work_item['description']}{criteria_field}"""

    def _build_work_item_evaluation_filters(self, work_item_type: str) -> Dict[str, Any]:
        """Creates search filters for work item evaluation knowledge base queries."""
        return {
            "filter": {
                "andAll": [
                    {"equals": {"key": "workItemType", "value": work_item_type}},
                    {"equals": {"key": "areaPath", "value": "agile-process"}},
                ]
            }
        }

    def _build_work_item_breakdown_filters(self, work_item: Dict[str, Any]) -> Dict[str, Any]:
        """Creates search filters for work item breakdown knowledge base queries."""
        filter_conditions = []

        if work_item.get("workItemType"):
            filter_conditions.append({"equals": {"key": "workItemType", "value": work_item["workItemType"]}})
        if work_item.get("areaPath"):
            filter_conditions.append({"equals": {"key": "areaPath", "value": work_item["areaPath"]}})
        if work_item.get("businessUnit"):
            filter_conditions.append({"equals": {"key": "businessUnit", "value": work_item["businessUnit"]}})
        if work_item.get("system"):
            filter_conditions.append({"equals": {"key": "system", "value": work_item["system"]}})

        if len(filter_conditions) >= 2:
            return {"filter": {"andAll": filter_conditions}}
        elif len(filter_conditions) == 1:
            return {"filter": filter_conditions[0]}
        else:
            return {}

    async def retrieve_knowledge_context(
        self, query: str, filters: Optional[Dict[str, Any]] = None
    ) -> List[BedrockKnowledgeDocument]:
        """Retrieves relevant documents from the AWS Bedrock knowledge base using vector search."""
        try:
            retrieval_config: Dict[str, Any] = {
                "vectorSearchConfiguration": {"numberOfResults": self.max_knowledge_documents}
            }
            if filters:
                retrieval_config["vectorSearchConfiguration"].update(filters)

            logger.debug(f"Retrieving knowledge base context", extra={
                "knowledgeBaseId": self.knowledge_base_id,
                "query": query,
                "filterConditions": filters,
                "maxResults": self.max_knowledge_documents,
            })

            response = self.bedrock_agent_client.retrieve(
                knowledgeBaseId=self.knowledge_base_id,
                retrievalQuery={"text": query},
                retrievalConfiguration=retrieval_config,
            )

            results = response.get("retrievalResults", [])
            logger.info(f"📄 Retrieved {len(results)} knowledge documents")

            return self._process_knowledge_results(results)

        except Exception as e:
            logger.warning(f"Failed to retrieve knowledge context: {e}")
            return []

    def _process_knowledge_results(self, results: List[Dict[str, Any]]) -> List[BedrockKnowledgeDocument]:
        """Processes raw knowledge base retrieval results into structured document objects."""
        documents = []
        for idx, result in enumerate(results):
            content = result.get("content", {}).get("text", "")
            source = result.get("location", {}).get("s3Location", {}).get("uri", f"Document {idx + 1}")
            score = result.get("score", 0.0)

            logger.debug(f"Processed knowledge chunk {idx + 1}", extra={
                "source": source,
                "contentLength": len(content),
                "score": score,
                "preview": content[:100] + ("..." if len(content) > 100 else ""),
            })

            documents.append(
                BedrockKnowledgeDocument(
                    content=content,
                    content_length=len(content),
                    source=source,
                    score=score,
                )
            )

        return documents

    # ==================== Work Item Evaluation ====================

    async def evaluate_work_item(self, work_item: Dict[str, Any]) -> BedrockWorkItemEvaluationResponse:
        """Evaluates a work item to determine if it's well-defined and ready for development."""
        try:
            logger.info(f"⚙️ Starting evaluation of {work_item['workItemType']} {work_item['workItemId']}")

            # Step 1: Try to retrieve relevant documents from Knowledge Base
            query = self._build_work_item_evaluation_knowledge_query(work_item)
            filters = self._build_work_item_evaluation_filters(work_item["workItemType"])
            knowledge_context = await self.retrieve_knowledge_context(query, filters)

            # Step 2: Use direct model inference with any retrieved context
            result = await self._invoke_model_for_work_item_evaluation(work_item, knowledge_context)

            logger.info(f"{work_item['workItemType']} evaluation completed", extra={
                "workItemId": work_item["workItemId"],
                "documentsRetrieved": len(knowledge_context),
                "result": result,
            })

            return result

        except Exception as e:
            logger.error(f"Failed to evaluate work item: {e}", extra={
                "workItemId": work_item.get("workItemId"),
            })
            raise

    async def _invoke_model_for_work_item_evaluation(
        self, work_item: Dict[str, Any], knowledge_context: List[BedrockKnowledgeDocument]
    ) -> BedrockWorkItemEvaluationResponse:
        """Invokes the Bedrock model to evaluate work item quality and readiness."""
        system_prompt = self._build_work_item_evaluation_system_prompt(work_item)
        user_prompt = self._build_work_item_evaluation_user_prompt(work_item, knowledge_context)
        content = await self._build_model_content(work_item, user_prompt)

        images_count = sum(1 for item in content if "image" in item)
        images_size_kb = sum(
            len(item.get("image", {}).get("source", {}).get("bytes", b"")) // 1024
            for item in content if "image" in item
        )

        logger.debug(f"🧠 Invoking Bedrock model for {work_item['workItemType']} Evaluation", extra={
            "modelId": self.model_id,
            "contextCount": len(content) - images_count,
            "knowledgeCount": len(knowledge_context),
            "knowledgeContentLength": sum(doc.content_length for doc in knowledge_context),
            "imagesCount": images_count,
            "imagesSizeKB": images_size_kb,
        })

        try:
            response = self.bedrock_runtime_client.converse(
                modelId=self.model_id,
                messages=[{"role": "user", "content": content}],
                inferenceConfig={"maxTokens": 2048, "temperature": 0.5},
                system=[{"text": system_prompt}],
            )

            logger.info("Received response from Bedrock model", extra={
                "response": response,
                "responseStatus": response.get("ResponseMetadata", {}).get("HTTPStatusCode"),
                "contentLength": len(response.get("output", {}).get("content", "")),
                "inputTokens": response.get("usage", {}).get("inputTokens"),
                "outputTokens": response.get("usage", {}).get("outputTokens"),
            })

            return self._parse_work_item_evaluation(response, knowledge_context)

        except Exception as e:
            logger.error(f"Model invocation failed: {e}", extra={
                "modelId": self.model_id,
            })
            raise Exception(f"Bedrock model invocation failed: {e}")

    def _build_work_item_evaluation_system_prompt(self, work_item: Dict[str, Any]) -> str:
        """Constructs the system prompt for work item evaluation."""
        evaluation_criteria = ""
        work_item_type = work_item.get("workItemType", "")

        if work_item_type == "Product Backlog Item":
            evaluation_criteria = """- Evaluate the product backlog item based on the following criteria:
  - It should generally state the user, the need, and the business value in some way.
  - The acceptance criteria should provide guidance that is testable or verifiable, though it need not be exhaustive.
  - The story should be appropriately sized for a development team to complete within a sprint."""
        elif work_item_type == "User Story":
            evaluation_criteria = """- Evaluate the user story based on the following criteria:
  - It should generally state the user, the need, and the business value in some way.
  - The acceptance criteria should provide guidance that is testable or verifiable, though it need not be exhaustive.
  - The story should be appropriately sized for a development team to complete within a sprint."""
        elif work_item_type == "Epic":
            evaluation_criteria = """- Evaluate the epic based on the following criteria:
  - It should clearly describe a high-level business objective or strategic goal.
  - The description should provide sufficient business context and rationale.
  - Success criteria should define measurable outcomes or business value.
  - The scope should be appropriate for breaking down into multiple features."""
        elif work_item_type == "Feature":
            evaluation_criteria = """- Evaluate the feature based on the following criteria:
  - It should describe a cohesive piece of functionality that delivers user value.
  - The description should clearly define the functional boundaries and user interactions.
  - Success criteria should be testable and define what constitutes completion.
  - The scope should be appropriate for breaking down into multiple user stories."""

        return f"""You are an AI assistant that reviews Azure DevOps work items. 
**Instructions**
- Evaluate the work item to check if it is reasonably clear and has enough detail for a developer or team to begin with minimal clarification.
- Your task is to assess the quality of a {work_item_type} based on the provided title, description, and available criteria fields.
{evaluation_criteria}
  - If images are provided, treat them as additional context to understand the work item.

**Output Rules**
- Return a JSON object with the following structure:
  - "pass": boolean (true if the work item is good enough to proceed, false only if it is seriously incomplete or confusing)
  - if "pass" is false, include a "comment" field (string) with a clear explanation of what's missing or unclear, and provide an example of a higher-quality {work_item_type} that would pass. If you have multiple feedback points, use line breaks and indentations with HTML tags.
- Only output the JSON object, no extra text outside it."""

    def _build_work_item_evaluation_user_prompt(
        self, work_item: Dict[str, Any], knowledge_context: List[BedrockKnowledgeDocument]
    ) -> str:
        """Constructs the user prompt for work item evaluation with knowledge context."""
        knowledge_section = ""
        if knowledge_context:
            knowledge_section = "\n".join(f"- {doc.content[:500]}..." for doc in knowledge_context)

        images_section = ""
        images = work_item.get("images", [])
        if images:
            images_section = "\n".join(
                f"{i + 1}. {img.get('url', '')}{' (' + img.get('alt', '') + ')' if img.get('alt') else ''}"
                for i, img in enumerate(images)
            )

        # Build criteria section based on work item type
        criteria_section = ""
        if self._is_user_story_or_pbi(work_item) and work_item.get("acceptanceCriteria"):
            criteria_section = f"\n  - Acceptance Criteria: {work_item['acceptanceCriteria']}"
        elif self._is_epic_or_feature(work_item) and work_item.get("successCriteria"):
            criteria_section = f"\n  - Success Criteria: {work_item['successCriteria']}"

        # Add Epic-specific fields
        epic_fields_section = ""
        if self._is_epic(work_item):
            epic_fields = []
            if work_item.get("objective"):
                epic_fields.append(f"  - Objective: {work_item['objective']}")
            if work_item.get("addressedRisks"):
                epic_fields.append(f"  - Addressed Risks: {work_item['addressedRisks']}")
            if work_item.get("pursueRisk"):
                epic_fields.append(f"  - Pursue Risk: {work_item['pursueRisk']}")
            if work_item.get("mostRecentUpdate"):
                epic_fields.append(f"  - Most Recent Update: {work_item['mostRecentUpdate']}")
            if work_item.get("outstandingActionItems"):
                epic_fields.append(f"  - Outstanding Action Items: {work_item['outstandingActionItems']}")
            if epic_fields:
                epic_fields_section = "\n" + "\n".join(epic_fields)

        # Add Feature-specific fields
        feature_fields_section = ""
        if self._is_feature(work_item) and work_item.get("businessDeliverable"):
            feature_fields_section = f"\n  - Business Deliverable: {work_item['businessDeliverable']}"

        # Add Product Backlog Item-specific fields
        pbi_fields_section = ""
        if self._is_product_backlog_item(work_item):
            pbi_fields = []
            if work_item.get("releaseNotes"):
                pbi_fields.append(f"  - Release Notes: {work_item['releaseNotes']}")
            if work_item.get("qaNotes"):
                pbi_fields.append(f"  - QA Notes: {work_item['qaNotes']}")
            if pbi_fields:
                pbi_fields_section = "\n" + "\n".join(pbi_fields)

        # Add User Story-specific fields
        user_story_fields_section = ""
        if self._is_user_story(work_item) and work_item.get("importance"):
            user_story_fields_section = f"\n  - Importance: {work_item['importance']}"

        return f"""**Context**
- Work item: 
Use this information to understand the scope and expectation for evaluation.
  - Work Item Type: {work_item.get('workItemType', '')}
  - Title: {work_item.get('title', '')}
  - Description: {work_item.get('description', '')}
  {criteria_section}
  {epic_fields_section}{feature_fields_section}{pbi_fields_section}{user_story_fields_section}
      
- Additional contextual knowledge (if any):
Extra domain knowledge, system information, or reference material to guide more context-aware and accurate evaluation.
  {knowledge_section or 'None'}

- Images (if any):
Visual aids or references that provide additional context for evaluation.
  {images_section or 'None'}"""

    def _parse_work_item_evaluation(
        self, response: Any, knowledge_context: List[BedrockKnowledgeDocument]
    ) -> BedrockWorkItemEvaluationResponse:
        """Parses the Bedrock model response for work item evaluation."""
        message_content = response.get("output", {}).get("message", {}).get("content", [])

        if not message_content or not isinstance(message_content, list) or len(message_content) == 0:
            logger.error("Invalid message content structure in Converse API response")
            raise Exception("Invalid message content structure in model response")

        content = message_content[0].get("text", "")

        if not content:
            logger.error("No text content found in first message content item")
            raise Exception("No text content found in model response")

        parsed_response = self._safe_json_parse(content)

        if not parsed_response:
            logger.error(f"Failed to parse JSON from model response: {content}")
            raise Exception("Invalid JSON response from model")

        logger.info("Parsed Bedrock model response", extra={"response": parsed_response})

        return BedrockWorkItemEvaluationResponse(
            passed=parsed_response.get("pass", False),
            comment=parsed_response.get("comment"),
            sources=[doc.source for doc in knowledge_context],
        )

    # ==================== Work Item Generation ====================

    async def generate_work_items(
        self,
        work_item: Dict[str, Any],
        existing_child_work_items: List[Dict[str, Any]],
        params: Optional[BedrockInferenceParams] = None,
    ) -> BedrockWorkItemGenerationResponse:
        """Generates work items using AI and knowledge base context."""
        try:
            params = params or BedrockInferenceParams()

            logger.info(f"⚙️ Starting work item generation of {work_item['workItemType']} {work_item['workItemId']}", extra={
                "workItemId": work_item["workItemId"],
                "isRefinement": bool(params.refinement_instructions),
            })

            # Step 1: Retrieve knowledge context
            query = self._build_work_item_breakdown_knowledge_query(work_item)
            filters = self._build_work_item_breakdown_filters(work_item)
            knowledge_context = await self.retrieve_knowledge_context(query, filters)

            # Step 2: Generate or Refine work items
            work_items = await self._invoke_model_for_work_item_generation(
                work_item, existing_child_work_items, params, knowledge_context
            )

            logger.info("Work item generation completed", extra={
                "workItemId": work_item["workItemId"],
                "workItemsCount": len(work_items),
                "documentsRetrieved": len(knowledge_context),
            })

            return BedrockWorkItemGenerationResponse(work_items=work_items, documents=knowledge_context)

        except Exception as e:
            logger.error(f"Failed to generate work items: {e}", extra={
                "workItemId": work_item.get("workItemId"),
            })
            raise

    async def _invoke_model_for_work_item_generation(
        self,
        work_item: Dict[str, Any],
        existing_child_work_items: List[Dict[str, Any]],
        params: BedrockInferenceParams,
        knowledge_context: List[BedrockKnowledgeDocument],
    ) -> List[Dict[str, Any]]:
        """Invokes the Bedrock model to generate child work items."""
        system_prompt = await self._build_work_item_generation_system_prompt(work_item, params)

        # Check if this is a refinement request
        if params.refinement_instructions and params.generated_work_items:
            user_prompt = await self._build_work_item_refinement_user_prompt(
                work_item,
                params.generated_work_items,
                params.refinement_instructions,
                existing_child_work_items,
                knowledge_context,
            )
        else:
            # Standard generation request
            user_prompt = await self._build_work_item_generation_user_prompt(
                work_item, existing_child_work_items, knowledge_context
            )

        content = await self._build_model_content(work_item, user_prompt)

        # Build inference config
        inference_config: Dict[str, Any] = {
            "maxTokens": params.max_tokens or MAX_OUTPUT_TOKENS,
        }

        # Add inference parameter (temperature OR topP, not both)
        if params.temperature:
            inference_config["temperature"] = params.temperature
        elif params.top_p:
            inference_config["topP"] = params.top_p
        else:
            # Default to temperature if neither is specified
            inference_config["temperature"] = 0.5

        images_count = sum(1 for item in content if "image" in item)
        images_size_kb = sum(
            len(item.get("image", {}).get("source", {}).get("bytes", b"")) // 1024
            for item in content if "image" in item
        )
        text_length = sum(len(item.get("text", "")) for item in content if "text" in item)

        child_type = self._get_expected_child_work_item_type(work_item, plural=False)
        logger.info(f"🧠 Invoking Bedrock model for {child_type} generation", extra={
            "modelId": self.model_id,
            "contentItems": len(content),
            "textLength": text_length,
            "existingWorkItemsCount": len(existing_child_work_items),
            "knowledgeCount": len(knowledge_context),
            "knowledgeContentLength": sum(doc.content_length for doc in knowledge_context),
            "imagesCount": images_count,
            "imagesSizeKB": images_size_kb,
            "inferenceConfig": inference_config,
        })

        try:
            response = self.bedrock_runtime_client.converse(
                modelId=self.model_id,
                messages=[{"role": "user", "content": content}],
                inferenceConfig=inference_config,
                system=[{"text": system_prompt}],
            )

            logger.info("Received response from Bedrock model", extra={
                "responseStatus": response.get("ResponseMetadata", {}).get("HTTPStatusCode"),
                "contentLength": len(response.get("output", {}).get("content", "")),
                "inputTokens": response.get("usage", {}).get("inputTokens"),
                "outputTokens": response.get("usage", {}).get("outputTokens"),
            })

            return self._parse_work_items(response)

        except Exception as e:
            logger.error(f"Model invocation failed: {e}", extra={
                "modelId": self.model_id,
                "messagesCount": len([{"role": "user", "content": content}], {}),
                "hasInferenceConfig": bool(inference_config),
                "contentItems": len(content),
                "contentTypes": [item.get("type") for item in content],
            })
            raise Exception(f"Bedrock model invocation failed: {e}")

    async def _build_work_item_generation_system_prompt(
        self, work_item: Dict[str, Any], params: BedrockInferenceParams
    ) -> str:
        """Constructs the system prompt for work item generation."""
        work_item_type = work_item.get("workItemType", "")
        process_template = work_item.get("processTemplate", "")
        default_prompt = ""

        if work_item_type == "Product Backlog Item":
            default_prompt = """You are an expert Agile software development assistant that specializes in decomposing a Product Backlog Item into clear, actionable, and appropriately sized Tasks.
**Instructions**
- Your task is to break down the provided Product Backlog Item into a sequence of Tasks that are clear and actionable for developers to work on. Each task should be independent and deployable.
- Ensure each Task has a title and a description that guides the developer (why, what, how, technical details, references to relevant systems/APIs).
- Avoid creating duplicate Tasks if they already exist.
- Do NOT create any Tasks for analysis, investigation, testing, or deployment."""
        elif work_item_type == "User Story":
            default_prompt = """You are an expert Agile software development assistant that specializes in decomposing a User Story into clear, actionable, and appropriately sized Tasks.
**Instructions**
- Your task is to break down the provided User Story into a sequence of Tasks that are clear and actionable for developers to work on. Each task should be independent and deployable.
- Ensure each Task has a title and a description that guides the developer (why, what, how, technical details, references to relevant systems/APIs).
- Avoid creating duplicate Tasks if they already exist.
- Do NOT create any Tasks for analysis, investigation, testing, or deployment."""
        elif work_item_type == "Feature":
            if process_template == "Scrum":
                default_prompt = """You are an expert Agile software development assistant that specializes in decomposing a Feature into clear, actionable, and appropriately sized Product Backlog Items.
**Instructions**
- Your task is to break down the provided Feature into a sequence of Product Backlog Items that are clear and deliver business value.
- Ensure each Product Backlog Item has a title, description, and acceptance criteria.
- Avoid creating duplicate Product Backlog Items if they already exist."""
            else:
                default_prompt = """You are an expert Agile software development assistant that specializes in decomposing a Feature into clear, actionable, and appropriately sized User Stories.
**Instructions**
- Your task is to break down the provided Feature into a sequence of User Stories that are clear and deliver business value.
- Ensure each User Story has a title, description, and acceptance criterial.
- Avoid creating duplicate User Stories if they already exist."""
        elif work_item_type == "Epic":
            default_prompt = """You are an expert Agile software development assistant that specializes in decomposing an Epic into clear, actionable, and appropriately sized Features.
**Instructions**
- Your task is to break down the provided Epic into a sequence of Features that are clear and deliver business value.
- Ensure each Feature has a title and a comprehensive description.
- Avoid creating duplicate Features if they already exist."""

        # Get base prompt (either custom override or default)
        base_prompt = (await self._resolve_prompt(work_item, params.prompt)) or default_prompt

        # Build output rules based on work item type
        if work_item_type in ["Product Backlog Item", "User Story"]:
            return f"""{base_prompt}

**Output Rules**
- ONLY return a JSON object with the following structure:
  - "workItems": array of task objects, each with:
    - "title": string (task title, prefixed with order, e.g., "1. Task Title")
    - "description": string (detailed task description with HTML formatting)
- DO NOT output any text outside of the JSON object."""
        elif work_item_type == "Feature":
            if process_template == "Scrum":
                return f"""{base_prompt}

**Output Rules**
- ONLY return a JSON object with the following structure:
  - "workItems": array of product backlog item objects, each with:
    - "title": string (product backlog item title, prefixed with order, e.g., "1. Product Backlog Item Title")
    - "description": string (detailed product backlog item description with HTML formatting)
    - "acceptanceCriteria": string (detailed acceptance criteria with HTML formatting)
- DO NOT output any text outside of the JSON object."""
            else:
                return f"""{base_prompt}

**Output Rules**
- ONLY return a JSON object with the following structure:
  - "workItems": array of user story objects, each with:
    - "title": string (user story title, prefixed with order, e.g., "1. User Story Title")
    - "description": string (detailed user story description with HTML formatting)
    - "acceptanceCriteria": string (detailed acceptance criteria with HTML formatting)
- DO NOT output any text outside of the JSON object."""
        elif work_item_type == "Epic":
            return f"""{base_prompt}

**Output Rules**
- ONLY return a JSON object with the following structure:
  - "workItems": array of feature objects, each with:
    - "title": string (feature title, prefixed with order, e.g., "1. Feature Title")
    - "description": string (detailed feature description with HTML formatting)
    - "successCriteria": string (detailed success criteria with HTML formatting)
- DO NOT output any text outside of the JSON object."""

        return base_prompt

    async def _build_work_item_generation_user_prompt(
        self,
        work_item: Dict[str, Any],
        existing_child_work_items: List[Dict[str, Any]],
        knowledge_context: List[BedrockKnowledgeDocument],
    ) -> str:
        """Constructs the user prompt for work item generation with all relevant context."""
        images = work_item.get("images", [])
        images_section = ""
        if images:
            images_section = "\n".join(
                f"{i + 1}. {img.get('url', '')}{' (' + img.get('alt', '') + ')' if img.get('alt') else ''}"
                for i, img in enumerate(images)
            )

        knowledge_section = ""
        if knowledge_context:
            knowledge_section = "\n".join(f"- {doc.content[:500]}..." for doc in knowledge_context)

        # Build criteria section based on work item type
        criteria_section = ""
        if self._is_user_story_or_pbi(work_item) and work_item.get("acceptanceCriteria"):
            criteria_section = f"\n  - Acceptance Criteria: {work_item['acceptanceCriteria']}"
        elif self._is_epic_or_feature(work_item) and work_item.get("successCriteria"):
            criteria_section = f"\n  - Success Criteria: {work_item['successCriteria']}"

        # Add type-specific fields
        type_specific_fields = ""
        if self._is_epic(work_item):
            epic_fields = []
            if work_item.get("objective"):
                epic_fields.append(f"  - Objective: {work_item['objective']}")
            if work_item.get("addressedRisks"):
                epic_fields.append(f"  - Addressed Risks: {work_item['addressedRisks']}")
            if work_item.get("pursueRisk"):
                epic_fields.append(f"  - Pursue Risk: {work_item['pursueRisk']}")
            if work_item.get("mostRecentUpdate"):
                epic_fields.append(f"  - Most Recent Update: {work_item['mostRecentUpdate']}")
            if work_item.get("outstandingActionItems"):
                epic_fields.append(f"  - Outstanding Action Items: {work_item['outstandingActionItems']}")
            if epic_fields:
                type_specific_fields = "\n" + "\n".join(epic_fields)
        elif self._is_feature(work_item) and work_item.get("businessDeliverable"):
            type_specific_fields = f"\n  - Business Deliverable: {work_item['businessDeliverable']}"
        elif self._is_product_backlog_item(work_item):
            pbi_fields = []
            if work_item.get("releaseNotes"):
                pbi_fields.append(f"  - Release Notes: {work_item['releaseNotes']}")
            if work_item.get("qaNotes"):
                pbi_fields.append(f"  - QA Notes: {work_item['qaNotes']}")
            if pbi_fields:
                type_specific_fields = "\n" + "\n".join(pbi_fields)
        elif self._is_user_story(work_item) and work_item.get("importance"):
            type_specific_fields = f"\n  - Importance: {work_item['importance']}"

        child_work_item_type = self._get_expected_child_work_item_type(work_item, plural=True) or "child work items"

        # Build the existing child work items list with type-specific details
        existing_child_work_items_list = "None"
        if existing_child_work_items:
            items = []
            for i, item in enumerate(existing_child_work_items):
                details = f"{i + 1}. {item.get('title', '')}"

                if child_work_item_type == "Features":
                    if item.get("businessDeliverable"):
                        details += f"\n   Business Deliverable: {item['businessDeliverable']}"
                    if item.get("successCriteria"):
                        details += f"\n   Success Criteria: {item['successCriteria']}"
                elif child_work_item_type == "Product Backlog Items":
                    if item.get("description"):
                        details += f"\n   Description: {item['description']}"
                    if item.get("acceptanceCriteria"):
                        details += f"\n   Acceptance Criteria: {item['acceptanceCriteria']}"
                    if item.get("releaseNotes"):
                        details += f"\n   Release Notes: {item['releaseNotes']}"
                    if item.get("qaNotes"):
                        details += f"\n   QA Notes: {item['qaNotes']}"
                elif child_work_item_type == "User Stories":
                    if item.get("description"):
                        details += f"\n   Description: {item['description']}"
                    if item.get("acceptanceCriteria"):
                        details += f"\n   Acceptance Criteria: {item['acceptanceCriteria']}"
                    if item.get("importance"):
                        details += f"\n   Importance: {item['importance']}"
                else:
                    if item.get("description"):
                        details += f"\n   Description: {item['description']}"

                items.append(details)

            existing_child_work_items_list = "\n\n".join(items)

        return f"""**Context**
- Work item:
Use this information to understand the scope and expectation to generate relevant tasks.
  - Work Item Type: {work_item.get('workItemType', '')}
  - Title: {work_item.get('title', '')}
  - Description: {work_item.get('description', '')}{criteria_section}{type_specific_fields}

- Existing {child_work_item_type} (if any):
Current {child_work_item_type} already created for this {work_item.get('workItemType', '')}. Avoid duplicating these; generate only missing or supplementary {child_work_item_type} for completeness.
  {existing_child_work_items_list}

- Images (if any):
Visual aids or references that provide additional context for task generation.
  {images_section or 'None'}
      
- Additional contextual knowledge (if any):
Extra domain knowledge, system information, or reference material to guide more context-aware and accurate task generation.
  {knowledge_section or 'None'}"""

    async def _build_work_item_refinement_user_prompt(
        self,
        work_item: Dict[str, Any],
        draft_work_items: List[Dict[str, Any]],
        instructions: str,
        existing_child_work_items: List[Dict[str, Any]],
        knowledge_context: List[BedrockKnowledgeDocument],
    ) -> str:
        """Constructs the user prompt for work item refinement based on user instructions."""
        child_work_item_type = self._get_expected_child_work_item_type(work_item, plural=True) or "child work items"

        # Format the current draft list
        draft_list = "\n\n".join(
            f"{i + 1}. {item.get('title', '')}\n   Description: {re.sub(r'<[^>]*>', '', item.get('description', ''))[:150]}..."
            for i, item in enumerate(draft_work_items)
        )

        # Build context similar to generation (brief version)
        knowledge_section = ""
        if knowledge_context:
            knowledge_section = f"\n\nReference Context:\n" + "\n".join(
                f"- {doc.content[:300]}..." for doc in knowledge_context
            )

        criteria_section = ""
        if self._is_user_story_or_pbi(work_item) and work_item.get("acceptanceCriteria"):
            criteria_section = f"\nRequired Criteria: {work_item['acceptanceCriteria']}"

        return f"""**Refinement Request**

You have previously generated a list of {child_work_item_type} for the {work_item.get('workItemType', '')}: "{work_item.get('title', '')}".
Criteria: {criteria_section}

**Current Draft List:**
{draft_list}

**User Instructions:**
"{instructions}"

**Task:**
Update the list of {child_work_item_type} based on the User Instructions. 
- If the user asks to add something, add it as a new item.
- If the user asks to remove something, remove it.
- If the user asks to change details, update the relevant item.
- Keep the rest of the list stable unless the instructions imply broader changes.
- Ensure all items remain clear, actionable, and appropriately sized.

Return the COMPLETE updated list of work items in the specified JSON format."""

    def _parse_work_items(self, response: Any) -> List[Dict[str, Any]]:
        """Parses the Bedrock model response and extracts generated work items."""
        # Log the full response structure for debugging
        logger.debug("Full Bedrock response structure for parsing", extra={
            "hasOutput": "output" in response,
            "hasMessage": "message" in response.get("output", {}),
            "hasContent": "content" in response.get("output", {}).get("message", {}),
            "contentLength": len(response.get("output", {}).get("message", {}).get("content", [])),
            "hasUsage": "usage" in response,
        })

        message_content = response.get("output", {}).get("message", {}).get("content", [])

        if not message_content or not isinstance(message_content, list) or len(message_content) == 0:
            logger.error("Invalid message content structure in Converse API response", extra={
                "hasOutput": "output" in response,
                "hasMessage": "message" in response.get("output", {}),
                "hasContent": "content" in response.get("output", {}).get("message", {}),
                "contentType": type(response.get("output", {}).get("message", {}).get("content")).__name__,
                "contentLength": len(message_content) if isinstance(message_content, list) else "not array",
                "response": response
            })
            raise Exception("🛑 Invalid message content structure in model response")

        content = message_content[0].get("text", "")
        output_tokens = response.get("usage", {}).get("outputTokens", 0)

        if not content:
            logger.error("No text content found in first message content item", extra={
                "firstItem": message_content[0] if message_content else None,
                "response": response,
            })
            raise Exception("🛑 No text content found in model response")

        if output_tokens and output_tokens >= MAX_OUTPUT_TOKENS:
            logger.error("🛑 Output token limit exceeded", extra={
                "outputTokens": output_tokens,
                "maxTokens": MAX_OUTPUT_TOKENS,
            })
            raise Exception("Model response exceeds maximum token limit")

        parsed_response = self._safe_json_parse(content)

        if not parsed_response or "workItems" not in parsed_response:
            logger.error("Failed to parse work items from model response", extra={
                "rawContent": content,
                "parsedResponse": parsed_response,
            })
            raise Exception("🛑 Invalid JSON response from model")

        logger.info("Received Bedrock model response", extra={
            "workItems": parsed_response["workItems"],
            "workItemsCount": len(parsed_response["workItems"]),
        })

        return parsed_response["workItems"]

    # ==================== Image Processing ====================

    async def _build_model_content(self, work_item: Dict[str, Any], user_prompt: str) -> List[Dict[str, Any]]:
        """Builds multi-modal content array combining text prompt with processed images."""
        content: List[Dict[str, Any]] = [{"text": user_prompt}]

        images = work_item.get("images", [])
        if not images:
            return content

        images_to_process = images[: self.max_images]

        for i, image in enumerate(images_to_process):
            try:
                # Import AzureService for fetching images
                from .azure_service import AzureService

                azure_service = AzureService()
                image_data = await azure_service.fetch_image(image.get("url", ""))

                if image_data and self._is_image_size_valid(image_data):
                    image_bytes = base64.b64decode(image_data)
                    image_format = self._detect_image_format(image_bytes)

                    content.append({
                        "image": {
                            "format": image_format,
                            "source": {"bytes": image_bytes},
                        }
                    })

                    logger.debug(f"📷 Added image ({i + 1} of {len(images_to_process)}) to model input", extra={
                        "url": image.get("url"),
                        "format": image_format,
                        "sizeKB": len(image_data) * 3 // 4 // 1024,
                    })

            except Exception as e:
                logger.warning(f"Failed to process image: {e}", extra={"url": image.get("url")})

        if len(images) > self.max_images:
            logger.info(f"Limited images for model input", extra={
                "total": len(images),
                "processed": self.max_images,
            })

        return content

    def _is_image_size_valid(self, base64_data: str) -> bool:
        """Validates that an image meets the configured size limits."""
        size_in_bytes = (len(base64_data) * 3) / 4
        size_in_mb = size_in_bytes / (1024 * 1024)

        if size_in_mb > self.max_image_size:
            logger.warning(f"Image exceeds size limit", extra={
                "actualSizeMB": round(size_in_mb, 2),
                "limitMB": self.max_image_size,
            })
            return False

        return True

    def _detect_image_format(self, buffer: bytes) -> str:
        """Detects image format from binary data by examining file signatures."""
        if len(buffer) >= 4:
            # JPEG: FF D8 FF
            if buffer[0] == 0xFF and buffer[1] == 0xD8 and buffer[2] == 0xFF:
                return "jpeg"
            # PNG: 89 50 4E 47
            if buffer[0] == 0x89 and buffer[1] == 0x50 and buffer[2] == 0x4E and buffer[3] == 0x47:
                return "png"
            # WebP: 52 49 46 46 ... 57 45 42 50
            if (
                buffer[0] == 0x52
                and buffer[1] == 0x49
                and buffer[2] == 0x46
                and buffer[3] == 0x46
                and len(buffer) >= 12
                and buffer[8] == 0x57
                and buffer[9] == 0x45
                and buffer[10] == 0x42
                and buffer[11] == 0x50
            ):
                return "webp"
            # GIF: 47 49 46 38
            if buffer[0] == 0x47 and buffer[1] == 0x49 and buffer[2] == 0x46 and buffer[3] == 0x38:
                return "gif"

        # Default to jpeg if we can't detect the format
        logger.warning("Could not detect image format, defaulting to jpeg", extra={
            "firstFourBytes": " ".join(f"{b:02x}" for b in buffer[:4]) if len(buffer) >= 4 else "insufficient data"
        })
        return "jpeg"

    # ==================== Utility Functions ====================

    def _safe_json_parse(self, input_str: str) -> Optional[Dict[str, Any]]:
        """Safely parses JSON strings with error handling for malformed model responses."""
        # Find the first '{' and the last '}'
        start = input_str.find("{")
        end = input_str.rfind("}")

        if start == -1 or end == -1 or end <= start:
            return None  # No valid JSON found

        json_substring = input_str[start : end + 1]

        try:
            return json.loads(json_substring)
        except json.JSONDecodeError:
            return None  # Invalid JSON

    async def _resolve_prompt(self, work_item: Dict[str, Any], parameter_prompt: Optional[str] = None) -> Optional[str]:
        """
        Resolves the prompt to use for work item generation with priority-based selection.
        Priority: 1) Parameter override, 2) Database config, 3) Default (undefined)
        """
        child_type = self._get_expected_child_work_item_type(work_item, plural=False)

        # If a prompt was passed as a parameter, use it (highest priority)
        if parameter_prompt:
            logger.info(f"⭐ Using prompt override for {child_type} generation", extra={
                "prompt": parameter_prompt,
                "source": "parameter",
            })
            return parameter_prompt

        database_prompt = await self._get_custom_prompt(work_item)
        if database_prompt:
            logger.info(f"⭐ Using prompt override for {child_type} generation", extra={
                "prompt": database_prompt,
                "source": "database",
            })
            return database_prompt

        # No override found, will use default prompt
        logger.debug("No prompt override found, using default prompt")
        return None

    async def _get_custom_prompt(self, work_item: Dict[str, Any]) -> Optional[str]:
        """Retrieves a custom prompt from the DynamoDB config table based on work item context."""
        if not self.config_table_name:
            logger.warning("Config table name not configured, skipping custom prompt lookup.")
            return None

        # Construct the adoKey from workItem properties including workItemType
        ado_key = f"{work_item.get('workItemType', '')}#{work_item.get('areaPath', '')}#{work_item.get('businessUnit', '')}#{work_item.get('system', '')}"

        try:
            response = self.dynamodb_client.get_item(
                TableName=self.config_table_name,
                Key={"adoKey": {"S": ado_key}},
            )

            if "Item" in response:
                config_item = response["Item"]
                prompt = config_item.get("prompt", {}).get("S")

                logger.debug("Found custom prompt override. Using prompt override.", extra={
                    "adoKey": ado_key,
                    "prompt": prompt,
                })

                return prompt

            return None

        except Exception as e:
            logger.error(f"Failed to retrieve custom prompt from config table: {e}", extra={
                "adoKey": ado_key,
            })
            return None
