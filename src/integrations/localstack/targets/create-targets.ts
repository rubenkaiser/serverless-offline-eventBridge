import {
  EventBridgeClient,
  EventBus,
  Rule,
  Target,
} from '@aws-sdk/client-eventbridge';
import { CloudFormationResources } from 'serverless/aws';
import {
  ServerlessResourceTypes,
  filterResources,
} from '../../../utils/serverless';
import { Config } from '../../../config/interfaces/config-interface';
import {
  RoleResourceTarget,
  createRuleTargets,
  listRuleTargets,
} from '../utils';
import { snsTargetHandler } from './target-handlers/sns-target-handler';

export interface CreateTargetsParams {
  resources: CloudFormationResources;
  config: Config;
  eventBridgeClient: EventBridgeClient;
  rule: Rule;
  bus: EventBus;
  logDebug: (message: string) => void;
}

export async function createTargets({
  resources,
  config,
  eventBridgeClient,
  rule,
  bus,
  logDebug,
}: CreateTargetsParams) {
  const eventBridgeMaxTargets = 5;

  const eventRulesResources = filterResources(
    resources,
    ServerlessResourceTypes.EVENTS_RULE
  );

  const existingTargetsForRule = await listRuleTargets({
    client: eventBridgeClient,
    ruleName: rule.Name as string,
  });

  const definedRuleTargets: Array<RoleResourceTarget> =
    (eventRulesResources.find(
      (ruleResource) =>
        rule.Name === ruleResource.resourceDefinition.Properties['Name']
    )?.resourceDefinition.Properties['Targets'] as Array<RoleResourceTarget>) ||
    [];

  const notExistingTargets = definedRuleTargets.reduce<Set<RoleResourceTarget>>(
    (accumulator, targetResource) => {
      const targetId = targetResource.Id;

      const doesNotExist = !existingTargetsForRule.some(
        (existingTarget) => existingTarget.Id === targetId
      );

      if (doesNotExist) {
        accumulator.add(targetResource);
      }

      return accumulator;
    },
    new Set()
  );

  logDebug(`Not existing targets: ${JSON.stringify([...notExistingTargets])}`);

  if (
    notExistingTargets.size > 0 &&
    existingTargetsForRule.length >= eventBridgeMaxTargets
  ) {
    throw new Error(
      `Max targets for rule: ${bus.Name} reached. Can not create new targets. Max targets: ${eventBridgeMaxTargets}`
    );
  }

  const ruleTargets = [...notExistingTargets].map((resourceTarget) => {
    let Arn: string;

    const targetResource = resources[resourceTarget.Arn.Ref];

    switch (targetResource.Type) {
      case ServerlessResourceTypes.SNS_TOPIC: {
        Arn = snsTargetHandler({
          targetResource,
          awsConfig: config?.awsConfig,
        }).arn;
        break;
      }
      default: {
        throw new Error(
          `Resource type ${targetResource.Type} not implemented.`
        );
      }
    }

    const result: Target = { Id: resourceTarget.Id, Arn };

    return result;
  });

  await createRuleTargets({
    client: eventBridgeClient,
    ruleName: rule.Name as string,
    targets: ruleTargets,
  });

  return { ruleName: rule.Name, createdTargets: ruleTargets };
}
