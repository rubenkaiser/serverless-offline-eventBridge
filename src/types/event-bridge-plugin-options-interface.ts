import { LocalStackPluginConfig } from './localstack-plugin-config-interface';

export interface EventBridgePluginConfigOptions {
  port?: number;
  mockEventBridgeServer?: boolean;
  hostname?: string;
  pubSubPort?: number;
  debug?: boolean;
  account?: string;
  maximumRetryAttempts?: number;
  retryDelayMs?: number;
  throwRetryExhausted?: boolean;
  payloadSizeLimit?: string;
  'imported-event-buses'?: { [key: string]: string };
  localStackConfig?: LocalStackPluginConfig;
}
