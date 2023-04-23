import { CloudFormationResource } from 'serverless/aws';
import { AwsConfig } from '../../../../types/aws-config-interface';

export interface SnsTargetHandlerParams {
  targetResource: CloudFormationResource;
  awsConfig: AwsConfig;
}

export function snsTargetHandler({
  targetResource,
  awsConfig,
}: SnsTargetHandlerParams) {
  const snsTopicName = targetResource.Properties['TopicName'];
  const arn = `arn:aws:sns:${awsConfig.region}:${awsConfig.accountId}:${snsTopicName}`;

  return { arn };
}
