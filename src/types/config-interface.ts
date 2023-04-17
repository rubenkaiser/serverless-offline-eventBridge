export interface Config {
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
  "imported-event-buses"?: { [key: string]: string };
}
