import type { Options as ServerlessPluginOptions } from 'serverless';
import type { Provider } from 'serverless/aws';
import { ServerlessOfflinePluginOptions } from './serverless-offline-interface';
import { EventBridgePluginConfigOptions } from './event-bridge-plugin-options-interface';

export interface PluginOptions
  extends Omit<ServerlessPluginOptions, 'region' | 'stage'>,
    Provider,
    ServerlessOfflinePluginOptions,
    EventBridgePluginConfigOptions {
  maximumRetryAttempts?: number;
  retryDelayMs?: number;
  throwRetryExhausted?: boolean;
}
