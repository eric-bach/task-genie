import { CfnOutput, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  Distribution,
  OriginAccessIdentity,
  ViewerProtocolPolicy,
  PriceClass,
  AllowedMethods,
  CachePolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { Certificate, ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Bucket, BlockPublicAccess, BucketAccessControl } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { BaseStackProps } from '../bin/task-genie';

export interface DocsStackProps extends BaseStackProps {
  params?: {
    domainName?: string;
    certificateArn?: string;
  };
}

export class DocsStack extends Stack {
  public readonly distributionDomainName: string;
  public readonly bucketName: string;

  constructor(scope: Construct, id: string, props: DocsStackProps) {
    super(scope, id, props);

    // S3 Bucket for hosting the static website
    const docsBucket = new Bucket(this, 'DocsBucket', {
      bucketName: `${props.appName}-docs-${props.envName}-${this.account}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront Origin Access Identity
    const originAccessIdentity = new OriginAccessIdentity(this, 'DocsOAI', {
      comment: `${props.appName}-docs-${props.envName}-oai`,
    });

    // Grant CloudFront access to S3 bucket
    docsBucket.grantRead(originAccessIdentity);

    // SSL Certificate (import existing certificate if ARN is provided)
    let certificate: ICertificate | undefined;
    if (props.params?.certificateArn) {
      certificate = Certificate.fromCertificateArn(this, 'DocsCertificate', props.params.certificateArn);
    }

    // CloudFront Distribution
    const distributionProps: any = {
      defaultBehavior: {
        origin: new S3Origin(docsBucket, { originAccessIdentity }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
      priceClass: PriceClass.PRICE_CLASS_100,
      comment: `${props.appName} Documentation - ${props.envName}`,
    };

    // Add custom domain configuration if provided
    if (props.params?.domainName && certificate) {
      distributionProps.domainNames = [props.params.domainName];
      distributionProps.certificate = certificate;
    }

    const distribution = new Distribution(this, 'DocsDistribution', distributionProps);

    // Deploy the built documentation to S3
    new BucketDeployment(this, 'DocsDeployment', {
      sources: [Source.asset('../docs/build')],
      destinationBucket: docsBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // Outputs
    new CfnOutput(this, 'DocsWebsiteURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Task Genie Documentation Website URL',
    });

    new CfnOutput(this, 'DocsS3BucketName', {
      value: docsBucket.bucketName,
      description: 'Documentation S3 Bucket Name',
    });

    new CfnOutput(this, 'DocsCloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'Documentation CloudFront Distribution ID',
    });

    // Store values for cross-stack references
    this.distributionDomainName = distribution.distributionDomainName;
    this.bucketName = docsBucket.bucketName;
  }
}
