Task Genie - Architecture

- Add frontend to test prompts - include free input and pre-defined templates

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

  - Update backend to not create ADO tasks (from the UI) if the WorkItemId = 0?
    X Create synchronous express step functions
    X Create a webhook API or infinite timeout API GW for the step function (UI bypasses parseUserStory)
    X Update UI POST to call new API
    - Update step function to allow calling directly from UI and custom prompts
      X Merge parseUserStory and evaluateUserStory
      X Remove step functions VPC endpoint
      - Update step function state transitions
      - Allow prompt as an input parameter
      - Build out finalizeResponse to return response
    - Add form to customize AI prompt in UI
    - Test the API call works from the UI
    - Display the generated tasks on the form
  - How to get the result that the user story does not meet requirements?
    - Return in the step function the response
    - Display the validation error on the form
  - Update the existing API endpoint to IP whitelist Azure DevOps IPs

- Create test scripts to test prompts with predefined user stories
  - Add user more real story examples to tests
  - Refine AI prompts
- Identify Azure authentication requirements
  - https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance?view=azure-devops
- Observability
  - Add histogram of requests over time
  - Add histogram of Lambda response times
  - Add cost of savings from refinement $65k/year
- Switch from PAT to Azure DevOps Application
  - https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance?view=azure-devops
- Documentation
  - Add documentation on how to create ADO Service Hooks
- Add Knowledge Bases
