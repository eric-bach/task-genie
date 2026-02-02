import { Logger } from '@aws-lambda-powertools/logger';
import { APIGatewayTokenAuthorizerEvent, APIGatewayAuthorizerResult, AuthResponse, PolicyDocument } from 'aws-lambda';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import * as jwt from 'jsonwebtoken';

const logger = new Logger({ serviceName: 'tokenAuthorizer' });

// Expected Audience (Extension ID)
const EXTENSION_ID = process.env.EXTENSION_ID;
if (!EXTENSION_ID) {
  throw new Error('EXTENSION_ID environment variable is required');
}
const EXTENSION_SECRET = process.env.EXTENSION_SECRET;
if (!EXTENSION_SECRET) {
  throw new Error('EXTENSION_SECRET environment variable is required');
}

export const lambdaHandler = async (event: APIGatewayTokenAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  logger.info('Authorizing request', { methodArn: event.methodArn });

  // Extract token from Bearer header
  const token = event.authorizationToken?.replace(/^Bearer\s+/i, '');

  try {
    // Development/Playground Bypass
    // If the token matches the secret directly, treat it as a trusted API Key for the playground
    if (token === EXTENSION_SECRET) {
      logger.info('🔓 Extension Secret used as API Key (Playground Bypass)');
      // Allow access to all resources
      const apiArn = event.methodArn.split('/').slice(0, 2).join('/') + '/*/*';
      return generatePolicy('playground-user', 'Allow', apiArn);
    }

    // HS256 verification with your publisher secret
    const decoded = jwt.verify(token, EXTENSION_SECRET, {
      algorithms: ['HS256'],
      audience: EXTENSION_ID,
    }) as jwt.JwtPayload;

    logger.info('✅ HS256 token verified', { sub: decoded.sub });

    // Allow access to all resources in this API to facilitate caching
    // methodArn format: arn:aws:execute-api:region:account:apiId/stage/method/resourcePath
    const apiArn = event.methodArn.split('/').slice(0, 2).join('/') + '/*/*';

    return generatePolicy(decoded.sub || 'user', 'Allow', apiArn);
  } catch (err: any) {
    logger.error('jwt.verify error details', {
      errName: err.name,
      errMessage: err.message,
      tokenParts: token.split('.').length,
    });

    throw new Error('Unauthorized');
  }
};

const generatePolicy = (principalId: string, effect: 'Allow' | 'Deny', resource: string): AuthResponse => {
  const policyDocument: PolicyDocument = {
    Version: '2012-10-17',
    Statement: [
      {
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource,
      },
    ],
  };

  return {
    principalId,
    policyDocument,
  };
};

export const handler = middy(lambdaHandler).use(injectLambdaContext(logger, { logEvent: true }));
