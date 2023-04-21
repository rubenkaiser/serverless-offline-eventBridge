import { handlerPath } from '@libs/handler-resolver';

export default {
  handler: `${handlerPath(__dirname)}/handler.main`,
  events: [
    {
      sqs: {
        enabled: true,
        batchSize: 1,
        maximumBatchingWindow: 1,
        arn: { 'Fn::GetAtt': ['SqsSampleQueue', 'Arn'] },
      },
    },
    /** You can uncomment this event to test NON localstack integration. Plugin will pic it up automatically.
     * Look in serverless.ts fot resource with type AWS::Events::EventBus.
     */
    // {
    //   eventBridge: {
    //     eventBus: 'sample-event-bus-unique-name',
    //     pattern: {
    //       source: ['test-script'],
    //     },
    //   },
    // },
  ],
};
