import {
  EventBridgeClient,
  PutTargetsCommand,
  Target,
} from '@aws-sdk/client-eventbridge';

export interface CreateRuleTargetsParams {
  client: EventBridgeClient;
  ruleName: string;
  eventBusName?: string;
  targets: Array<Target>;
}

export async function createRuleTargets({
  client,
  ruleName,
  eventBusName,
  targets,
}: CreateRuleTargetsParams) {
  const command = new PutTargetsCommand({
    Rule: ruleName,
    EventBusName: eventBusName,
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
