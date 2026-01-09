import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AzureService } from '../../../services/AzureService';

const logger = new Logger({ serviceName: 'GetWorkItem' });
const azureService = new AzureService();

function stripHtml(html: string | undefined): string {
    if (!html) return '';
    // Replace breaks and end of paragraphs/divs with newlines
    let text = html.replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n');
    // Strip all other tags
    text = text.replace(/<[^>]+>/g, '');
    // Decode common entities
    text = text.replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
    return text.trim();
}

export const lambdaHandler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    try {
        const workItemIdParam = event.pathParameters?.id;
        if (!workItemIdParam) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({ message: 'Missing work item ID' }),
            };
        }

        const workItemId = parseInt(workItemIdParam, 10);
        if (isNaN(workItemId)) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({ message: 'Invalid work item ID' }),
            };
        }

        const teamProject = event.queryStringParameters?.teamProject;

        logger.info(`▶️ Looking up work item ${workItemId} in project ${teamProject || 'default'}`);

        const workItem = await azureService.getWorkItem(workItemId, teamProject);

        // Extract relevant fields
        const responseData = {
            title: workItem.fields['System.Title'],
            description: stripHtml(workItem.fields['System.Description']),
            acceptanceCriteria: stripHtml(
                workItem.fields['Microsoft.VSTS.Common.AcceptanceCriteria']
            ),
        };

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify(responseData),
        };
    } catch (error: any) {
        logger.error('Error fetching work item', { error });

        // Check for 404 from Azure Service (likely returns 404 status in response or throws error)
        if (error.message && error.message.includes('404')) {
            return {
                statusCode: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({ message: 'Work item not found' }),
            };
        }

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
                message: 'Internal server error',
                error: error.message,
            }),
        };
    }
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
