import { EventBridgeClient, PutRuleCommand } from '@aws-sdk/client-eventbridge';

export interface RoleResourceTarget {
  Id: string;
  Arn: { Ref: string };
}

export interface RuleResourceProperties {
  Name: string;
  Description: string;
  EventBusName: string;
  EventPattern: {
    'detail-type': Array<string>;
    source: Array<string>;
  };
  ScheduleExpression?: string;
  Targets: Array<RoleResourceTarget>;
}

export interface CreateEventBusRuleParams {
  client: EventBridgeClient;
  ruleProperties: RuleResourceProperties;
}

export async function createEventBusRule({
  client,
  ruleProperties,
}: CreateEventBusRuleParams) {
  const command = new PutRuleCommand({
    Name: ruleProperties.Name,
    Description: ruleProperties.Description,
    EventBusName: ruleProperties.EventBusName,
    EventPattern: JSON.stringify(ruleProperties.EventPattern),
    ScheduleExpression: ruleProperties.ScheduleExpression,
  });

  const createdBus = await client.send(command);

  return createdBus.RuleArn;
}
