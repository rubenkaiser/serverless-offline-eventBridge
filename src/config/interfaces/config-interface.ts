import { PluginOptions } from "../../types/plugin-options-interface";
import { EventBridgePluginConfigOptions } from "../../types/event-bridge-plugin-options-interface";
import { AwsConfig } from "../../types/aws-config-interface";
import { EventBridgeMockServerConfig } from "../../types/event-bridge-mock-server-config-interface";

export interface Config {
  awsConfig: AwsConfig;
  eventBridgeMockServerConfig: EventBridgeMockServerConfig;
  pluginConfigOptions?: EventBridgePluginConfigOptions;
  pluginOptions?: PluginOptions;
}
