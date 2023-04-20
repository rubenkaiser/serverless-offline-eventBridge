import { EventBridge } from 'serverless/aws';

export interface Subscriber {
  event: EventBridge;
  functionKey: string;
}
