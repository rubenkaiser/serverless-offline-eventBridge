/* eslint-disable spaced-comment */
import { all } from 'deepmerge';
import { removeEmpty } from '../utils/remove-empty';
import { Config } from './interfaces/config-interface';

type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

/** Default config value and later const to import in project. Mutable! */
const defaultConfig: Config = {
  awsConfig: {
    region: 'us-east-1',
    /**Default localstack accountId */
    accountId: '000000000000',
  },
  localStackConfig: {
    localStackEnabled: false,
    localStackEndpoint: 'http://localhost:4566',
  },
  eventBridgeMockServerConfig: {
    shouldMockEventBridgeServer: true,
    mockServerPort: 4010,
    mockMqttClientHostname: '127.0.0.1',
    mockMqttClientPubSubPort: 4011,
    payloadSizeLimit: '10mb',
    importedEventBuses: {},
  },
  pluginConfigOptions: {
    debug: false,
  },
};

/** Will ignore undefined and keep default at deep level */
export const setConfig = (configPart: DeepPartial<Config>): Config => {
  const mergedConfig = all<Config>([
    defaultConfig,
    removeEmpty(configPart) as Config,
  ]);

  return mergedConfig;
};
