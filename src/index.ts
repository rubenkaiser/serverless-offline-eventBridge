/* eslint-disable import/no-import-module-exports */
import type Serverless from 'serverless';
import type Plugin from 'serverless/classes/Plugin';
import type { Express } from 'express';
import * as express from 'express';
import type { Server } from 'http';

import { Hooks, Logging } from 'serverless/classes/Plugin';
import type { Lambda as LambdaType } from 'serverless-offline/lambda';
import { createServer, Server as netServer } from 'net';
import * as Aedes from 'aedes';
import * as cors from 'cors';
import * as mqtt from 'mqtt';
import * as cron from 'node-cron';
import {
  EventBridge,
  Input,
} from 'serverless/plugins/aws/provider/awsProvider';
import * as jsonpath from 'jsonpath';
import { EventBridgePluginConfigOptions } from './types/event-bridge-plugin-options-interface';
import { PluginOptions } from './types/plugin-options-interface';
import { Config } from './config/interfaces/config-interface';
import { setConfig } from './config/config';
import { Subscriber } from './types/subscriber-interface';
import { createEventBridgeResources } from './integrations/localstack';
import { ServerlessResourceTypes } from './utils/serverless';

class ServerlessOfflineAwsEventBridgePlugin implements Plugin {
  public hooks: Hooks;

  public config?: Config;

  public lambda?: LambdaType;

  public app?: Express;

  public eventBridgeServer?: Server;

  public mqServer?: netServer;

  public mqClient?: mqtt.MqttClient;

  public eventBuses: { [key: string]: string } = {};

  public subscribers: Array<Subscriber> = [];

  public scheduledEvents: Array<{
    schedule: string;
    event: EventBridge;
    functionKey: string;
  }> = [];

  constructor(
    private readonly serverless: Serverless,
    private options: PluginOptions,
    private readonly logging: Logging
  ) {
    this.logDebug = this.logDebug.bind(this);
    this.logNotice = this.logNotice.bind(this);

    this.hooks = {
      'before:offline:start': () => this.start(),
      'before:offline:start:init': () => this.start(),
      'after:offline:start:end': () => this.stop(),
    };
  }

  async start() {
    this.logDebug('start');

    await this.init();

    if (
      !this.config?.localStackConfig.localStackEnabled &&
      this.config?.eventBridgeMockServerConfig.shouldMockEventBridgeServer
    ) {
      if (!this.app) {
        throw new Error('Express app not running');
      }

      // Start Express Server
      this.eventBridgeServer = this.app.listen(
        this.config?.eventBridgeMockServerConfig.mockServerPort,
        () => {
          this.logNotice(
            `Mock server running at port: ${this.config?.eventBridgeMockServerConfig.mockServerPort}`
          );
        }
      );
    }
  }

  async stop() {
    this.init();
    this.logDebug('stop');

    if (this.eventBridgeServer) {
      this.eventBridgeServer.close();
    }

    if (this.lambda) {
      await this.lambda.cleanup();
    }
  }

  async init() {
    const pluginOptions = this.setupPluginOptions();

    const pluginConfig: EventBridgePluginConfigOptions =
      this.serverless.service.custom['serverless-offline-aws-eventbridge'] ||
      {};

    this.config = setConfig({
      awsConfig: {
        region: this.serverless.service.provider.region,
        accountId: pluginConfig?.account,
      },
      localStackConfig: {
        localStackEnabled: !!pluginConfig.localStackConfig,
        localStackEndpoint: pluginConfig.localStackConfig?.localStackEndpoint,
      },
      eventBridgeMockServerConfig: {
        shouldMockEventBridgeServer: pluginConfig.mockEventBridgeServer,
        mockServerPort: pluginConfig?.port,
        mockMqttClientHostname: pluginConfig.hostname,
        mockMqttClientPubSubPort: pluginConfig.pubSubPort,
        payloadSizeLimit: pluginConfig.payloadSizeLimit,
        importedEventBuses: pluginConfig['imported-event-buses'],
      },
      pluginConfigOptions: pluginConfig,
      pluginOptions,
    });

    const { subscribers, lambdas, scheduledEvents } = this.getEvents();
    this.subscribers = subscribers;
    this.scheduledEvents = scheduledEvents;
    this.eventBuses = this.extractCustomBuses();

    if (this.config?.localStackConfig.localStackEnabled) {
      this.logNotice(`Localstack config active`);
      await this.setupLocalStack();
    }

    if (!this.config?.localStackConfig.localStackEnabled) {
      this.setupMqBroker();
      this.setupMqClient();
      this.setupScheduledEvents();
      await this.createLambdas(lambdas);
      this.setupExpressApp();
    }

    this.logNotice('Plugin ready');
  }

  private setupMqBroker() {
    // If the stack receives EventBridge events, start the MQ broker as well
    if (this.config?.eventBridgeMockServerConfig.shouldMockEventBridgeServer) {
      this.mqServer = createServer((Aedes as any)().handle);
      this.mqServer.listen(
        this.config?.eventBridgeMockServerConfig.mockMqttClientPubSubPort,
        () => {
          this.logDebug(
            `MQTT Broker started and listening on port ${this.config?.eventBridgeMockServerConfig.mockMqttClientPubSubPort}`
          );
        }
      );
    }
  }

  private setupMqClient() {
    // Connect to the MQ server for any lambdas listening to EventBridge events
    this.mqClient = mqtt.connect(
      `mqtt://${this.config?.eventBridgeMockServerConfig.mockMqttClientHostname}:${this.config?.eventBridgeMockServerConfig.mockMqttClientPubSubPort}`
    );

    this.mqClient.on('connect', () => {
      if (!this.mqClient) {
        throw new Error('this.mqClient not present');
      }

      this.mqClient.subscribe('eventBridge', (_err, granted) => {
        // if the client is already subscribed, granted will be an empty array.
        // This prevents duplicate message processing when the client reconnects
        if (!granted || granted.length === 0) return;

        this.logDebug(
          `MQTT broker connected and listening on mqtt://${this.config?.eventBridgeMockServerConfig.mockMqttClientHostname}:${this.config?.eventBridgeMockServerConfig.mockMqttClientPubSubPort}`
        );

        if (!this.mqClient) {
          throw new Error('No this.mqClient');
        }

        this.mqClient.on('message', async (_topic, message) => {
          const entries = JSON.parse(message.toString());
          const invokedLambdas = this.invokeSubscribers(entries);
          if (invokedLambdas.length) {
            await Promise.all(invokedLambdas);
          }
        });
      });
    });
  }

  private setupPluginOptions() {
    const {
      service: { custom = {}, provider },
    } = this.serverless;

    const offlineOptions = custom['serverless-offline'];
    const offlineEventBridgeOptions =
      custom['serverless-offline-aws-eventbridge'];

    this.options = {
      ...this.options,
      ...provider,
      ...offlineOptions,
      ...offlineEventBridgeOptions,
    };

    if (typeof this.options.maximumRetryAttempts === 'undefined') {
      this.options.maximumRetryAttempts = 10;
    }

    if (typeof this.options.retryDelayMs === 'undefined') {
      this.options.retryDelayMs = 500;
    }

    if (typeof this.options.throwRetryExhausted === 'undefined') {
      this.options.throwRetryExhausted = true;
    }

    return this.options;
  }

  private setupExpressApp() {
    // initialise the express app
    this.app = express();
    this.app.use(cors());
    this.app.use(
      express.json({
        type: 'application/x-amz-json-1.1',
        limit: this.config?.eventBridgeMockServerConfig.payloadSizeLimit,
      })
    );
    this.app.use(
      express.urlencoded({
        extended: true,
        limit: this.config?.eventBridgeMockServerConfig.payloadSizeLimit,
      })
    );
    this.app.use((_req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header(
        'Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept, Authorization, Content-Length, ETag, X-CSRF-Token, Content-Disposition'
      );
      res.header(
        'Access-Control-Allow-Methods',
        'PUT, POST, GET, DELETE, HEAD, OPTIONS'
      );
      next();
    });

    this.app.all('*', async (req, res) => {
      if (this.mqClient) {
        this.mqClient.publish(
          'eventBridge',
          JSON.stringify(req.body?.Entries || [])
        );
      }
      res.json(this.generateEventBridgeResponse(req.body?.Entries || []));
      res.status(200).send();
    });
  }

  private setupScheduledEvents() {
    // loop the scheduled events and create a cron for them
    this.scheduledEvents.forEach((scheduledEvent) => {
      cron.schedule(scheduledEvent.schedule, async () => {
        this.logDebug(`run scheduled function ${scheduledEvent.functionKey}`);
        this.invokeSubscriber(
          scheduledEvent.functionKey,
          {
            Source: `Scheduled function ${scheduledEvent.functionKey}`,
            Resources: [],
            Detail: `{ "name": "Scheduled function ${scheduledEvent.functionKey}"}`,
          },
          scheduledEvent.event?.input
        );
      });
    });
  }

  private async setupLocalStack() {
    const {
      service: { resources: { Resources } = {} },
    } = this.serverless;

    await createEventBridgeResources({
      resources: Resources,
      config: this.config as Config,
      subscribers: this.subscribers,
      logDebug: this.logDebug,
      logNotice: this.logNotice,
    });
  }

  /**
   * Returns an EventBridge response as defined in the official documentation:
   * https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_PutEvents.html
   */
  // eslint-disable-next-line class-methods-use-this
  generateEventBridgeResponse(entries: Array<unknown>) {
    return {
      Entries: entries.map(() => {
        return {
          EventId: `xxxxxxxx-xxxx-xxxx-xxxx-${new Date().getTime()}`,
        };
      }),
      FailedEntryCount: 0,
    };
  }

  extractCustomBuses() {
    const {
      service: { resources: { Resources } = {} },
    } = this.serverless;
    const eventBuses: { [key: string]: string } = {};

    // eslint-disable-next-line no-restricted-syntax
    for (const key in Resources) {
      if (
        Object.prototype.hasOwnProperty.call(Resources, key) &&
        Resources[key].Type === ServerlessResourceTypes.EVENT_BUS
      ) {
        eventBuses[key] = Resources[key].Properties.Name;
      }
    }

    return eventBuses;
  }

  invokeSubscribers(entries: any) {
    if (!entries) return [];
    this.logDebug('checking event subscribers');

    const invoked = [];

    // eslint-disable-next-line no-restricted-syntax
    for (const entry of entries) {
      // eslint-disable-next-line no-restricted-syntax
      for (const {
        functionKey,
        event: { input } = { input: undefined },
      } of this.subscribers.filter((subscriber) =>
        this.verifyIsSubscribed(subscriber, entry)
      )) {
        invoked.push(this.invokeSubscriber(functionKey, entry, input));
      }
    }

    return invoked;
  }

  async invokeSubscriber(
    functionKey: any,
    entry: any,
    input: Input | undefined,
    retry = 0
  ) {
    const {
      retryDelayMs,
      maximumRetryAttempts: maxRetries,
      throwRetryExhausted,
    } = this.options;

    if (!this.lambda) {
      throw new Error('Lambda not present');
    }

    const lambdaFunction = this.lambda.get(functionKey);
    const event = this.convertEntryAndInputToEvent(entry, input);
    lambdaFunction.setEvent(event);
    try {
      await lambdaFunction.runHandler();
      this.logDebug(
        `${functionKey} successfully processed event with id ${event.id}`
      );
    } catch (err) {
      if (retry < (maxRetries as number)) {
        this.logDebug(
          `error: ${
            (err as Error).message || err
          } occurred in ${functionKey} on ${retry}/${maxRetries}, will retry`
        );
        await new Promise((resolve) => {
          setTimeout(resolve, retryDelayMs);
        });
        await this.invokeSubscriber(functionKey, entry, input, retry + 1);
        return;
      }
      this.logDebug(
        `error: ${
          (err as Error).message || err
        } occurred in ${functionKey} on attempt ${retry}, max attempts reached`
      );
      if (throwRetryExhausted) {
        throw err;
      }
    }
  }

  async createLambdas(lambdas: Array<LambdaType>) {
    // https://github.com/import-js/eslint-plugin-import/issues/2495
    // eslint-disable-next-line import/no-unresolved, prettier/prettier
    const { default: Lambda } = (await import("serverless-offline/lambda") as any);
    this.lambda = new Lambda(this.serverless, this.options) as LambdaType;
    this.lambda.create(lambdas);
  }

  verifyIsSubscribed(
    subscriber: any,
    entry: { EventBusName: string; DetailType: string; Detail: string }
  ) {
    const subscribedChecks = [];

    if (subscriber.event.eventBus && entry.EventBusName) {
      subscribedChecks.push(
        this.compareEventBusName(subscriber.event.eventBus, entry.EventBusName)
      );
    }

    if (subscriber.event.pattern) {
      if (subscriber.event.pattern.source) {
        subscribedChecks.push(
          this.verifyIfValueMatchesEventBridgePatterns(
            entry,
            'Source',
            subscriber.event.pattern.source
          )
        );
      }

      if (entry.DetailType && subscriber.event.pattern['detail-type']) {
        subscribedChecks.push(
          this.verifyIfValueMatchesEventBridgePatterns(
            entry,
            'DetailType',
            subscriber.event.pattern['detail-type']
          )
        );
      }

      if (entry.Detail && subscriber.event.pattern.detail) {
        const detail = JSON.parse(entry.Detail);
        const flattenedPatternDetailObject = this.flattenObject(
          subscriber.event.pattern.detail
        );

        if ('$or' in flattenedPatternDetailObject) {
          // check for existence of any value in the pattern in the provided value
          subscribedChecks.push(
            flattenedPatternDetailObject['$or'].some((pattern: unknown) => {
              const flattenedPatternDetailObjectOr =
                this.flattenObject(pattern);

              return Object.entries(flattenedPatternDetailObjectOr).every(
                ([key, value]) =>
                  this.verifyIfValueMatchesEventBridgePatterns(
                    detail,
                    key,
                    value
                  )
              );
            })
          );
        } else {
          // check for existence of every value in the pattern in the provided value
          // eslint-disable-next-line no-restricted-syntax
          for (const [key, value] of Object.entries(
            flattenedPatternDetailObject
          )) {
            subscribedChecks.push(
              this.verifyIfValueMatchesEventBridgePatterns(detail, key, value)
            );
          }
        }
      }
    }

    const subscribed = subscribedChecks.every((x) => x);
    this.logDebug(
      `${subscriber.functionKey} ${subscribed ? 'is' : 'is not'} subscribed`
    );
    return subscribed;
  }

  verifyIfValueMatchesEventBridgePatterns(
    object: any,
    field: any,
    patterns: any
  ) {
    if (!object) {
      return false;
    }

    let matchPatterns = patterns;
    if (!Array.isArray(matchPatterns)) {
      matchPatterns = [matchPatterns];
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const pattern of matchPatterns) {
      if (this.verifyIfValueMatchesEventBridgePattern(object, field, pattern)) {
        return true; // Return true as soon as a pattern matches the content
      }
    }

    return false;
  }

  /**
   * Implementation of content-based filtering specific to Eventbridge event patterns
   * https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns-content-based-filtering.html
   */
  verifyIfValueMatchesEventBridgePattern(
    object: any,
    field: any,
    pattern: any
  ): any {
    const splitField = field.split('.');
    const requiredJsonPathString = splitField.reduce(
      (accumulator: string, currentField: string) => {
        const objectPath = `${accumulator}.${currentField}`;
        const arrayPath = `${objectPath}[:]`;
        return jsonpath.query(object, arrayPath, 1).length > 0
          ? arrayPath
          : objectPath;
      },
      '$'
    );

    // evaluatedValues will ALWAYS be an array, since it's the result of a jsonpath query.
    const evaluatedValues = jsonpath.query(object, requiredJsonPathString);
    this.logDebug(`Evaluating ${requiredJsonPathString}`);

    // Simple scalar comparison
    if (typeof pattern !== 'object') {
      return evaluatedValues.includes(pattern);
    }

    // "exists" filters
    if ('exists' in pattern) {
      return pattern.exists
        ? evaluatedValues.length > 0
        : evaluatedValues.length === 0;
    }

    if ('anything-but' in pattern) {
      const evaluatePattern = Array.isArray(pattern['anything-but'])
        ? pattern['anything-but']
        : [pattern['anything-but']];
      // return !evaluatePattern.includes(evaluatedValues);
      return !evaluatedValues.some((v) => evaluatePattern.includes(v));
    }

    const filterType = Object.keys(pattern)[0];

    if (filterType === 'prefix') {
      return evaluatedValues.some((value) => value.startsWith(pattern.prefix));
    }

    if (filterType === 'suffix') {
      return evaluatedValues.some((value) => value.endsWith(pattern.suffix));
    }

    if (filterType === 'equals-ignore-case') {
      return evaluatedValues.some(
        (value) =>
          value.toLowerCase() === pattern['equals-ignore-case'].toLowerCase()
      );
    }

    if ('numeric' in pattern) {
      // partition an array to be like [[">", 5], ["=",30]]
      const chunk: any = (arr = [], num = 2) => {
        if (arr.length === 0) return arr;
        return Array(arr.splice(0, num)).concat(chunk(arr, num));
      };

      // persist pattern for preventing to mutate an array.
      const origin = [...pattern.numeric];

      const operationGroups = chunk(origin, 2);

      return evaluatedValues.some((value: any) =>
        // Expected all event pattern should be true
        operationGroups.every((arr: any) => {
          const lvalue = parseFloat(value);
          const rvalue = parseFloat(arr[arr.length - 1]);
          const operator = arr[0];

          return (
            {
              '>': lvalue > rvalue,
              '<': lvalue < rvalue,
              '>=': lvalue >= rvalue,
              '<=': lvalue <= rvalue,
              '=': lvalue === rvalue,
            } as any
          )[operator];
        })
      );
    }

    // "cidr" filters and the recurring logic are yet supported by this plugin.
    throw new Error(
      `The ${filterType} eventBridge filter is not supported in serverless-offline-aws-eventBridge yet. ` +
        `Please consider submitting a PR to support it.`
    );
  }

  compareEventBusName(eventBus: any, eventBusName: string) {
    if (typeof eventBus === 'string') {
      return eventBus.includes(eventBusName);
    }

    if (
      Object.prototype.hasOwnProperty.call(eventBus, 'Ref') ||
      Object.prototype.hasOwnProperty.call(eventBus, 'Fn::Ref') ||
      Object.prototype.hasOwnProperty.call(eventBus, 'Fn::GetAtt')
    ) {
      const resourceName =
        eventBus.Ref || eventBus['Fn::Ref'] || eventBus['Fn::GetAtt'][0];

      if (this.eventBuses[resourceName]) {
        return (
          this.eventBuses[resourceName] &&
          this.eventBuses[resourceName].includes(eventBusName)
        );
      }
    }

    if (Object.prototype.hasOwnProperty.call(eventBus, 'Fn::ImportValue')) {
      const importedResourceName = eventBus['Fn::ImportValue'];

      return (
        this.config?.eventBridgeMockServerConfig.importedEventBuses[
          importedResourceName
        ] &&
        this.config?.eventBridgeMockServerConfig.importedEventBuses[
          importedResourceName
        ].includes(eventBusName)
      );
    }

    return false;
  }

  getEvents() {
    const { service } = this.serverless;
    const functionKeys = service.getAllFunctions();
    const subscribers = [];
    const scheduledEvents = [];
    const lambdas: Array<LambdaType> = [];

    // eslint-disable-next-line no-restricted-syntax
    for (const functionKey of functionKeys) {
      const functionDefinition = service.getFunction(functionKey);

      lambdas.push({ functionKey, functionDefinition } as any);

      if (functionDefinition.events) {
        // eslint-disable-next-line no-restricted-syntax
        for (const event of functionDefinition.events) {
          if (event.eventBridge) {
            if (
              typeof (event.eventBridge as any).enabled === 'undefined' ||
              (event.eventBridge as any).enabled === true
            ) {
              if (!event.eventBridge.schedule) {
                subscribers.push({
                  event: event.eventBridge,
                  functionKey,
                });
              } else {
                let convertedSchedule;

                if (event.eventBridge.schedule.indexOf('rate') > -1) {
                  const rate = event.eventBridge.schedule
                    .replace('rate(', '')
                    .replace(')', '');

                  const parts = rate.split(' ');

                  if (parts[1]) {
                    if (parts[1].startsWith('minute')) {
                      convertedSchedule = `*/${parts[0]} * * * *`;
                    } else if (parts[1].startsWith('hour')) {
                      convertedSchedule = `0 */${parts[0]} * * *`;
                    } else if (parts[1].startsWith('day')) {
                      convertedSchedule = `0 0 */${parts[0]} * *`;
                    } else {
                      this.logDebug(
                        `Invalid·schedule·rate·syntax·'${rate}',·will·not·schedule`
                      );
                    }
                  }
                } else {
                  // get the cron job syntax right: cron(0 5 * * ? *)
                  //
                  //      min     hours       dayOfMonth  Month       DayOfWeek   Year        (AWS)
                  // sec  min     hour        dayOfMonth  Month       DayOfWeek               (node-cron)
                  // seconds is optional so we don't use it with node-cron
                  convertedSchedule = `${event.eventBridge.schedule.substring(
                    5,
                    event.eventBridge.schedule.length - 3
                  )}`;
                  // replace ? by * for node-cron
                  convertedSchedule = convertedSchedule.split('?').join('*');
                  // replace 0/x by */x for node-cron
                  convertedSchedule = convertedSchedule.replaceAll(
                    /0\//gi,
                    '*/'
                  );
                }
                if (convertedSchedule) {
                  scheduledEvents.push({
                    schedule: convertedSchedule,
                    event: event.eventBridge,
                    functionKey,
                  });
                  this.logDebug(
                    `Scheduled '${functionKey}' with syntax ${convertedSchedule}`
                  );
                } else {
                  this.logDebug(
                    `Invalid schedule syntax '${event.eventBridge.schedule}', will not schedule`
                  );
                }
              }
            }
          }
        }
      }
    }

    return {
      subscribers,
      scheduledEvents,
      lambdas,
    };
  }

  convertEntryAndInputToEvent(entry: any, input: Input | undefined) {
    try {
      const event: any = {
        ...(input || {}),
        version: '0',
        id: `xxxxxxxx-xxxx-xxxx-xxxx-${new Date().getTime()}`,
        source: entry.Source,
        account: this.config?.awsConfig.accountId,
        time: new Date().toISOString(),
        region: this.config?.awsConfig.region,
        resources: entry.Resources || [],
        detail: JSON.parse(entry.Detail),
      };

      if (entry.DetailType) {
        event['detail-type'] = entry.DetailType;
      }

      return event;
    } catch (error) {
      this.logDebug(
        `error converting entry to event: ${
          (error as Error).message
        }. returning entry instead`
      );
      return {
        ...entry,
        id: `xxxxxxxx-xxxx-xxxx-xxxx-${new Date().getTime()}`,
      };
    }
  }

  flattenObject(object: any, prefix = ''): any {
    return Object.entries(object).reduce(
      (accumulator, [key, value]) =>
        value &&
        value instanceof Object &&
        !(value instanceof Date) &&
        !Array.isArray(value)
          ? {
              ...accumulator,
              ...this.flattenObject(value, (prefix && `${prefix}.`) + key),
            }
          : { ...accumulator, [(prefix && `${prefix}.`) + key]: value },
      {}
    );
  }

  logDebug(message: string) {
    if (this.config?.pluginConfigOptions?.debug) {
      this.logging.log.notice(
        `serverless-offline-aws-eventbridge [DEBUG] :: ${message}`
      );
    }
  }

  logNotice(message: string) {
    this.logging.log.notice(`serverless-offline-aws-eventbridge :: ${message}`);
  }
}

module.exports = ServerlessOfflineAwsEventBridgePlugin;
