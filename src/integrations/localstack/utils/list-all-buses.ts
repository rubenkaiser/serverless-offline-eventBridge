import {
  EventBridgeClient,
  ListEventBusesCommand,
} from '@aws-sdk/client-eventbridge';

export interface ListAllBusesParams {
  client: EventBridgeClient;
}

export async function listAllBuses({ client }: ListAllBusesParams) {
  const command = new ListEventBusesCommand({});
  const allBridges = await client.send(command);

  return allBridges.EventBuses || [];
}
