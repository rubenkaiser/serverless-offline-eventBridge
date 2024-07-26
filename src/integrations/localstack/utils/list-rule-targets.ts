import {
  EventBridgeClient,
  ListTargetsByRuleCommand,
} from '@aws-sdk/client-eventbridge';

export interface ListRuleTargetsParams {
  client: EventBridgeClient;
  ruleName: string;
  eventBusName?: string;
}

export async function listRuleTargets({
  client,
  ruleName,
  eventBusName,
}: ListRuleTargetsParams) {
  const command = new ListTargetsByRuleCommand({
    Rule: ruleName,
    EventBusName: eventBusName,
  });
  const allTargets = await client.send(command);

  return allTargets.Targets || [];
}
