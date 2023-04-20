import { EventBridgeClient, EventBus } from '@aws-sdk/client-eventbridge';
import { CloudFormationResources } from 'serverless/aws';
import { listBusRules } from '../utils';
import { createTargets } from './create-targets';
import { Config } from '../../../config/interfaces/config-interface';

export interface CreateBusRulesTargetsParams {
  resources: CloudFormationResources;
  config: Config;
  eventBridgeClient: EventBridgeClient;
  bus: EventBus;
  logDebug: (message: string) => void;
}

export async function createBusRulesTargets({
  resources,
  config,
  eventBridgeClient,
  bus,
  logDebug,
}: CreateBusRulesTargetsParams) {
  const allBusRules = await listBusRules({
    eventBusName: bus.Name as string,
    client: eventBridgeClient,
  });

  const createdTargetsForRules = await Promise.all(
    allBusRules.map(async (rule) =>
      createTargets({
        resources,
        config,
        eventBridgeClient,
        bus,
        rule,
        logDebug,
      })
    )
  );

  return { busName: bus.Name, createdTargetsForRules };
}
