import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { CloudFormationResources } from 'serverless/aws';
import { Config } from '../../../config/interfaces/config-interface';
import { listAllBuses } from '../utils';
import { createBusRulesTargets } from './create-targets-bus-rules';

export interface CreateRuleTargetsParams {
  resources: CloudFormationResources;
  config: Config;
  eventBridgeClient: EventBridgeClient;
  logDebug: (message: string) => void;
}

export async function createEventBridgeRulesTargets({
  resources,
  config,
  eventBridgeClient,
  logDebug,
}: CreateRuleTargetsParams) {
  const allBuses = await listAllBuses({
    client: eventBridgeClient,
  });

  const createdTargetsForAllBuses = await Promise.all(
    allBuses.map(async (bus) =>
      createBusRulesTargets({
        resources,
        config,
        eventBridgeClient,
        bus,
        logDebug,
      })
    )
  );

  return { createdTargetsForAllBuses };
}
