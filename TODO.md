Task Genie - Architecture

X Add frontend to test prompts - include free input and pre-defined templates
X Initial Nextjs app
X Add Cognito backend
X Add Amplify Auth
X Add shadcn
X Add shadcn blocks - https://nsui.irung.me/
X Add public landing page
X Add sidebar
X Build form for user story
X Build form to display validations and generated tasks
X Add API GW with API Key (x-api-key) authorizer
X Update ADO Service Hooks to include x-api-key header
X Hookup NextJS client to POST to API GW with x-api-key header
X Update backend to not create ADO tasks (from the UI) if the WorkItemId = 0?
X Create synchronous express step functions
X Create a webhook API or infinite timeout API GW for the step function (UI bypasses parseUserStory)
X Update UI POST to call new API
X Update step function to allow calling directly from UI and custom prompts
X Merge parseUserStory and evaluateUserStory
X Remove step functions VPC endpoint
X Update step function state transitions
X Build out finalizeResponse to accept input from Tasks and return API response
X Test why some tasks are not always linked
X Test API for different use cases
X Add a isValid (true/false) and modified (true/false) in the response
X Move interface types to common type file
X Add emoji to logs to make it easier to identify errors
X Allow prompt as an input parameter
X Optimize lambda compute settings
X Prevent multiple runs by checking for the presense of a Tag?

- Add form to customize AI prompt in UI
- Test the API call works from the UI
- Display the generated tasks on the form
- Identify Azure authentication requirements
  - https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance?view=azure-devops
- Observability
  - Add histogram of requests over time
  - Add histogram of Lambda response times
  - Add log metric filter of errors
  - Add cost of savings from refinement $65k/year
- Switch from PAT to Azure DevOps Application
  - https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance?view=azure-devops
- Add Knowledge Bases
- TD: Update the existing API endpoint to IP whitelist Azure DevOps IPs
- TD: Review Azure DevOps API calls to handle errors
- TD: Add documentation on how to create ADO Service Hooks
