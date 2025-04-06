### ToDo

- Switch from PAT to Azure DevOps Application - https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance?view=azure-devops

  - Create a Service Principal in Azure Portal (1st video)
    - Share "Application (Client) Id" from Azure Portal
    - Share "Directory (tenant) Id" from Azure Portal
  - Add the Service Principal to the Users in Azure DevOps [Oranization Settings -> Users] (1st video)
  - Add the Service Principal to the Project groups in Azure DevOps [Project Settings -> Permissions] (2nd video)
  - Get a token for the Service Principal - https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow#get-a-token
  - Call Azure DevOps API (3rd video, 3:04-8:50)
    - Create a Client Sercret (4:35)

- Observability

  - Add histogram of requests over time
  - Add histogram of Lambda response times
  - Add log metric filter of errors
  - Add cost of savings from refinement $65k/year

- Add Knowledge Bases

  - Store code in S3 bucket
  - Use S3 as data source for Knowledge Base

- TD: Update the existing API endpoint to IP whitelist Azure DevOps IPs
- TD: Review Azure DevOps API calls to handle errors
