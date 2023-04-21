/* eslint-disable no-console */
// eslint-disable-next-line import/no-extraneous-dependencies
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';

const region = 'us-east-1';
const endpoint = 'http://localhost:4566';
const eventBusName = 'sample-event-bus-unique-name';
const source = 'test-script';
const detailType = 'sample-detail-type';
const detail = { message: 'hello world' };

(async () => {
  try {
    const eventBridgeClient = new EventBridgeClient({
      endpoint,
      region,
    });
    const command = new PutEventsCommand({
      Entries: [
        {
          EventBusName: eventBusName,
          Source: source,
          DetailType: detailType,
          Detail: JSON.stringify(detail),
        },
      ],
    });
    const result = await eventBridgeClient.send(command);

    console.log('RESULT', result);
  } catch (err) {
    console.log(err);
  }
})();
