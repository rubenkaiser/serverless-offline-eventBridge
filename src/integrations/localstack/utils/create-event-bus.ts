import {
  EventBridgeClient,
  CreateEventBusCommand,
} from '@aws-sdk/client-eventbridge';

export interface CreateEventBusParams {
  client: EventBridgeClient;
  name: string;
}

export async function createEventBus({ client, name }: CreateEventBusParams) {
  const command = new CreateEventBusCommand({
    Name: name,
  });
  const createdBus = await client.send(command);

  return createdBus.EventBusArn;
}
