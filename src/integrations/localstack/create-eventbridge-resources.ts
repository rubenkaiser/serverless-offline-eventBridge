import { CloudFormationResources } from 'serverless/aws';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { Config } from '../../config/interfaces/config-interface';
import { Subscriber } from '../../types/subscriber-interface';
import { createEventBridgeRules } from './rules/create-eventbridge-rules';
import { createEventBuses } from './buses/create-event-buses';
import { createEventBridgeRulesTargets } from './targets/create-eventbridge-rules-targets';
import { setsToArrays } from '../../utils/sets-to-array';

export interface CreateEventBridgeResourcesParams {
  resources: CloudFormationResources;
  config: Config;
  subscribers: Array<Subscriber>;
  logDebug: (message: string) => void;
  logNotice: (message: string) => void;
}

export async function createEventBridgeResources({
  resources,
  config,
  subscribers,
  logDebug,
  logNotice,
}: CreateEventBridgeResourcesParams) {
  const eventBridgeClient = new EventBridgeClient({
    endpoint: config?.localStackConfig.localStackEndpoint,
    region: config?.awsConfig.region,
  });

  await createEventBuses({
    eventBridgeClient,
    subscribers,
    resources,
    logDebug,
  });

  await createEventBridgeRules({
    resources,
    eventBridgeClient,
    logDebug,
  });

  const createdTargetsForAllBuses = await createEventBridgeRulesTargets({
    resources,
    config,
    eventBridgeClient,
    logDebug,
  });

  logDebug(
    `All created targets: ${JSON.stringify(
      setsToArrays(createdTargetsForAllBuses)
    )}`
  );
  logNotice('Resources created in localstack');
}
