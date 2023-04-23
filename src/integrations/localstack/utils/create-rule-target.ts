import {
  EventBridgeClient,
  PutTargetsCommand,
  Target,
} from '@aws-sdk/client-eventbridge';

export interface CreateRuleTargetsParams {
  client: EventBridgeClient;
  ruleName: string;
  targets: Array<Target>;
}

export async function createRuleTargets({
  client,
  ruleName,
  targets,
}: CreateRuleTargetsParams) {
  const command = new PutTargetsCommand({
    Rule: ruleName,
    Targets: targets,
  });
  const createdTargets = await client.send(command);

  if (createdTargets.FailedEntryCount) {
    throw new Error(
      `Failed to create targets. Amount ${createdTargets.FailedEntryCount}`
    );
  }

  return createdTargets;
}
