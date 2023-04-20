import {
  EventBridgeClient,
  ListTargetsByRuleCommand,
} from '@aws-sdk/client-eventbridge';

export interface ListRuleTargetsParams {
  client: EventBridgeClient;
  ruleName: string;
}

export async function listRuleTargets({
  client,
  ruleName,
}: ListRuleTargetsParams) {
  const command = new ListTargetsByRuleCommand({ Rule: ruleName });
  const allTargets = await client.send(command);

  return allTargets.Targets || [];
}
