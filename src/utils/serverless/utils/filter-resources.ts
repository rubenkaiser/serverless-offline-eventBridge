import {
  CloudFormationResource,
  CloudFormationResources,
} from 'serverless/aws';
import { ServerlessResourceTypes } from '../types';

export interface FilteredResource {
  resourceName: string;
  resourceDefinition: CloudFormationResource;
}

export function filterResources(
  resources: CloudFormationResources,
  resourceType: ServerlessResourceTypes
) {
  const filteredResources = Object.entries<CloudFormationResource>(
    resources
  ).reduce<Array<FilteredResource>>((accumulator, entry) => {
    const [resKey, resValue] = entry;

    const isCorrectType = resValue.Type === resourceType;

    if (isCorrectType) {
      accumulator.push({ resourceName: resKey, resourceDefinition: resValue });
    }

    return accumulator;
  }, []);

  return filteredResources;
}
