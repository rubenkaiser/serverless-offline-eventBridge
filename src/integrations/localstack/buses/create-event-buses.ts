import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { CloudFormationResources } from 'serverless/aws';
import { Subscriber } from '../../../types/subscriber-interface';
import { createEventBus, listAllBuses } from '../utils';
import {
  ServerlessResourceTypes,
  filterResources,
} from '../../../utils/serverless';

export interface CreateEventBusesParams {
  eventBridgeClient: EventBridgeClient;
  subscribers: Array<Subscriber>;
  resources: CloudFormationResources;
  logDebug: (message: string) => void;
}

function normalizeEventBusName(eventBus: string) {
  // if busName is actually the arn, normalize it to just the name
  if (eventBus.toLowerCase().startsWith('arn:')) {
    return eventBus.split('/')[1];
  }

  return eventBus;
}

export async function createEventBuses({
  subscribers,
  resources,
  eventBridgeClient,
  logDebug,
}: CreateEventBusesParams) {
  const eventBusesResources = filterResources(
    resources,
    ServerlessResourceTypes.EVENT_BUS
  );

  const allExistingBuses = await listAllBuses({
    client: eventBridgeClient,
  });

  const allDefinedBuses = [
    ...subscribers.map((subFunc) =>
      normalizeEventBusName(subFunc.event.eventBus as string)
    ),
    ...eventBusesResources.map((busResource) =>
      normalizeEventBusName(
        busResource.resourceDefinition.Properties['Name'] as string
      )
    ),
  ];

  const notExistingBuses = allDefinedBuses.reduce<Set<string>>(
    (accumulator, currBus) => {
      const doesNotExist = !allExistingBuses.some((existingBus) => {
        return allDefinedBuses.some(
          (definedBus) => existingBus.Name === definedBus
        );
      });

      if (doesNotExist) {
        accumulator.add(currBus);
      }

      return accumulator;
    },
    new Set()
  );

  logDebug(`Not existing buses: ${JSON.stringify([...notExistingBuses])}`);

  const createdBuses = await Promise.all(
    [...notExistingBuses].map(async (notExistingBus) => {
      const createdBus = await createEventBus({
        client: eventBridgeClient,
        name: notExistingBus,
      });

      return { createdBusName: notExistingBus, arn: createdBus };
    })
  );

  return createdBuses;
}
