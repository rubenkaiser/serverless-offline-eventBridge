import {
  EventBridgeClient,
  ListRulesCommand,
} from '@aws-sdk/client-eventbridge';

export interface ListBusTargetsParams {
  client: EventBridgeClient;
  eventBusName: string;
}

export async function listBusRules({
  client,
  eventBusName,
}: ListBusTargetsParams) {
  const command = new ListRulesCommand({ EventBusName: eventBusName });
  const allTargets = await client.send(command);

  return allTargets.Rules || [];
}
