import type { Options as ServerlessPluginOptions } from "serverless";

export interface Options extends ServerlessPluginOptions {
  maximumRetryAttempts?: number;
  retryDelayMs?: number;
  throwRetryExhausted?: boolean;
}
