import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { Subscriber } from '../../../types/subscriber-interface';
import { createEventBus, listAllBuses } from '../utils';

export interface CreateEventBusesParams {
  eventBridgeClient: EventBridgeClient;
  subscribers: Array<Subscriber>;
  logDebug: (message: string) => void;
}

export async function createEventBuses({
  subscribers,
  eventBridgeClient,
  logDebug,
}: CreateEventBusesParams) {
  const allExistingBuses = await listAllBuses({
    client: eventBridgeClient,
  });

  const notExistingBuses = subscribers.reduce<Set<{ eventBusName: string }>>(
    (accumulator, currSubscriber) => {
      const doesNotExist = !allExistingBuses.some((existingBus) => {
        return subscribers.some(
          (subFunc) => existingBus.Name === subFunc.event.eventBus
        );
      });

      if (doesNotExist) {
        accumulator.add({
          eventBusName: currSubscriber.event.eventBus as string,
        });
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
        name: notExistingBus.eventBusName,
      });

      return { createdBusName: notExistingBus.eventBusName, arn: createdBus };
    })
  );

  return createdBuses;
}
