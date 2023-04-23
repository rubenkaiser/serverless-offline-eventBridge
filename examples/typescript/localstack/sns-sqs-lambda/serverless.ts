import type { AWS } from '@serverless/typescript';

import hello from '@functions/hello';

const AWS_ACCOUNT_ID = '000000000000';
const AWS_DEFAULT_REGION = 'us-east-1';

const serverlessConfiguration: AWS = {
  service: 'sns-sqs-lambda',
  frameworkVersion: '3',
  plugins: [
    'serverless-esbuild',
    'serverless-offline',
    'serverless-offline-sqs',
    'serverless-offline-sns',
    // 'serverless-offline-aws-eventbridge',
    /** Remember to build plugin on top of repository */
    '../../../../dist/src/index.js',
  ],
  provider: {
    name: 'aws',
    runtime: 'nodejs14.x',
    apiGateway: {
      minimumCompressionSize: 1024,
      shouldStartNameWithService: true,
    },
    environment: {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      NODE_OPTIONS: '--enable-source-maps --stack-trace-limit=1000',
    },
  },
  // import the function via paths
  functions: { hello },
  resources: {
    Resources: {
      SampleEventBus: {
        Type: 'AWS::Events::EventBus',
        Properties: {
          Name: 'sample-event-bus-unique-name',
        },
      },
      EventBridgeSampleRule: {
        Type: 'AWS::Events::Rule',
        Properties: {
          Name: 'Sample unique rule name',
          Description: 'This is description of sample role',
          EventBusName: 'sample-event-bus-unique-name',
          EventPattern: {
            'detail-type': ['sample-detail-type'],
            source: ['test-script'],
          },
          Targets: [
            {
              Arn: { Ref: 'SnsSampleTopic' },
              Id: 'SNSTopic',
            },
          ],
        },
      },
      SnsSampleTopic: {
        Type: 'AWS::SNS::Topic',
        Properties: {
          TopicName: 'sample-sns-topic',
        },
      },
      SqsSampleQueue: {
        Type: 'AWS::SQS::Queue',
        Properties: {
          QueueName: 'sample-sqs-queue',
        },
      },
    },
  },
  package: { individually: true },
  custom: {
    esbuild: {
      bundle: true,
      minify: false,
      sourcemap: true,
      exclude: ['aws-sdk'],
      target: 'ES2020',
      define: { 'require.resolve': undefined },
      platform: 'node',
      concurrency: 10,
    },
    'serverless-offline': {
      httpPort: 3003,
    },
    'serverless-offline-sns': {
      port: 4002,
      'sns-endpoint': 'http://localhost:4566',
      accountId: AWS_ACCOUNT_ID,
      autoSubscribe: false,
      subscriptions: [
        {
          topic: {
            topicName: 'sample-sns-topic',
            rawMessageDelivery: 'true',
          },
          queue: `arn:aws:sqs:${AWS_DEFAULT_REGION}:${AWS_ACCOUNT_ID}:sample-sqs-queue`,
        },
      ],
    },
    'serverless-offline-sqs': {
      autoCreate: true,
      apiVersion: '2012-11-05',
      endpoint: 'http://0.0.0.0:4566',
      region: AWS_DEFAULT_REGION,
      accessKeyId: 'root',
      secretAccessKey: 'root',
      skipCacheInvalidation: false,
    },
    'serverless-offline-aws-eventbridge': {
      account: AWS_ACCOUNT_ID,
      localStackConfig: {
        localStackEndpoint: 'http://localhost:4566',
      },
    },
  },
};

module.exports = serverlessConfiguration;
