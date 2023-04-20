import { CloudFormationResources } from 'serverless/aws';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import {
  RuleResourceProperties,
  createEventBusRule,
  listAllBuses,
  listBusRules,
} from '../utils';
import {
  ServerlessResourceTypes,
  filterResources,
} from '../../../utils/serverless';

export interface CreateEventBridgeRulesParams {
  resources: CloudFormationResources;
  eventBridgeClient: EventBridgeClient;
  logDebug: (message: string) => void;
}

export async function createEventBridgeRules({
  resources,
  eventBridgeClient,
  logDebug,
}: CreateEventBridgeRulesParams) {
  const allBuses = await listAllBuses({
    client: eventBridgeClient,
  });

  const allCreatedRulesForBuses = await Promise.all(
    allBuses.map(async (bus) => {
      const eventBridgeMaxRules = 300;

      const eventRulesResources = filterResources(
        resources,
        ServerlessResourceTypes.EVENTS_RULE
      );

      const existingRules = await listBusRules({
        client: eventBridgeClient,
        eventBusName: bus.Name as string,
      });

      const notExistingRules = eventRulesResources.reduce<
        Set<RuleResourceProperties>
      >((accumulator, ruleResource) => {
        const ruleProperties = ruleResource.resourceDefinition
          .Properties as RuleResourceProperties;

        const doesNotExist = !existingRules.some(
          (existingRule) => existingRule.Name === ruleProperties.Name
        );

        if (doesNotExist) {
          accumulator.add(ruleProperties);
        }

        return accumulator;
      }, new Set());

      logDebug(`Not existing rules: ${JSON.stringify([...notExistingRules])}`);

      if (
        notExistingRules.size > 0 &&
        existingRules.length >= eventBridgeMaxRules
      ) {
        throw new Error(
          `Max rules for bus: ${bus.Name} reached. Can not create new rules. Max rules: ${eventBridgeMaxRules}`
        );
      }

      const allCreatedRules = await Promise.all(
        [...notExistingRules].map(async (notExistingRule) => {
          return createEventBusRule({
            client: eventBridgeClient,
            ruleProperties: notExistingRule,
          });
        })
      );

      return { busName: bus.Name, allCreatedRules };
    })
  );

  return allCreatedRulesForBuses;
}
