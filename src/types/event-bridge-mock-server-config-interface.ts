export interface EventBridgeMockServerConfig {
  shouldMockEventBridgeServer: boolean;
  mockServerPort: number;
  mockMqttClientHostname: string;
  mockMqttClientPubSubPort: number;
  payloadSizeLimit: string;
  importedEventBuses: { [key: string]: string };
}
