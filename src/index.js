"use strict";

const express = require("express");
const cors = require("cors");
const aedes = require("aedes");
const net = require("net");
const mqtt = require("mqtt");
const Lambda = require("serverless-offline/dist/lambda").default;

class ServerlessOfflineAwsEventbridgePlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.lambda = null;
    this.options = options;
    this.config = null;
    this.port = null;
    this.hostname = null;
    this.pubSubPort = null;
    this.account = null;
    this.debug = null;
    this.importedEventBuses = {};
    this.eventBridgeServer = null;
    this.mockEventBridgeServer = null;
    this.payloadSizeLimit = null;

    this.mqServer = null;
    this.mqClient = null;

    this.eventBuses = {};
    this.subscribers = [];
    this.scheduleIntervals = [];
    this.app = null;

    this.hooks = {
      "before:offline:start": () => this.start(),
      "before:offline:start:init": () => this.start(),
      "after:offline:start:end": () => this.stop(),
    };
  }

  async start() {
    this.log("start");
    this.init();

    if (this.mockEventBridgeServer) {
      // Start Express Server
      this.eventBridgeServer = this.app.listen(this.port);
    }
  }

  async stop() {
    this.init();
    this.log("stop");
    this.eventBridgeServer.close();
    if (this.lambda) await this.lambda.cleanup();
    this.scheduleIntervals.forEach(i => clearInterval(i))
  }

  init() {
    this.config =
      this.serverless.service.custom["serverless-offline-aws-eventbridge"] ||
      {};
    this.port = this.config.port || 4010;
    this.mockEventBridgeServer =
      "mockEventBridgeServer" in this.config
        ? this.config.mockEventBridgeServer
        : true;
    this.hostname = this.config.hostname || "127.0.0.1";
    this.pubSubPort = this.config.pubSubPort || 4011;
    this.account = this.config.account || "";
    this.region = this.serverless.service.provider.region || "us-east-1";
    this.debug = this.config.debug || false;
    this.importedEventBuses = this.config["imported-event-buses"] || {};
    this.payloadSizeLimit = this.config.payloadSizeLimit || "10mb";

    const {
      service: { custom = {}, provider },
    } = this.serverless;

    // If the stack receives EventBridge events, start the MQ broker as well
    if (this.mockEventBridgeServer) {
      this.mqServer = net.createServer(aedes().handle);
      this.mqServer.listen(this.pubSubPort, () => {
        this.log(
          `MQTT Broker started and listening on port ${this.pubSubPort}`
        );
      });
    }

    // Connect to the MQ server for any lambdas listening to EventBridge events
    this.mqClient = mqtt.connect(`mqtt://${this.hostname}:${this.pubSubPort}`);

    this.mqClient.on("connect", () => {
      this.mqClient.subscribe("eventBridge", (_err, granted) => {
        // if the client is already subscribed, granted will be an empty array.
        // This prevents duplicate message processing when the client reconnects
        if (!granted || granted.length === 0) return;

        this.log(
          `MQTT broker connected and listening on mqtt://${this.hostname}:${this.pubSubPort}`
        );
        this.mqClient.on("message", async (_topic, message) => {
          const entries = JSON.parse(message.toString());
          const invokedLambdas = this.invokeSubscribers(entries);
          if (invokedLambdas.length) {
            await Promise.all(invokedLambdas);
          }
        });
      });
    });

    const offlineOptions = custom["serverless-offline"];
    const offlineEventBridgeOptions =
      custom["serverless-offline-aws-eventbridge"];

    this.options = {
      ...this.options,
      ...provider,
      ...offlineOptions,
      ...offlineEventBridgeOptions,
    };

    if (typeof this.options.maximumRetryAttempts === "undefined") {
      this.options.maximumRetryAttempts = 10;
    }

    if (typeof this.options.retryDelayMs === "undefined") {
      this.options.retryDelayMs = 500;
    }

    const { subscribers, lambdas, scheduleIntervals } = this.getEvents();

    this.eventBuses = this.extractCustomBuses();
    this.createLambda(lambdas);
    this.subscribers = subscribers;
    this.scheduleIntervals = scheduleIntervals;

    // initialise the express app
    this.app = express();
    this.app.use(cors());
    this.app.use(
      express.json({
        type: "application/x-amz-json-1.1",
        limit: this.payloadSizeLimit,
      })
    );
    this.app.use(
      express.urlencoded({ extended: true, limit: this.payloadSizeLimit })
    );
    this.app.use((_req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization, Content-Length, ETag, X-CSRF-Token, Content-Disposition"
      );
      res.header(
        "Access-Control-Allow-Methods",
        "PUT, POST, GET, DELETE, HEAD, OPTIONS"
      );
      next();
    });

    this.app.all("*", async (req, res) => {
      if (this.mqClient) {
        this.mqClient.publish("eventBridge", JSON.stringify(req.body.Entries));
      }
      res.json(this.generateEventBridgeResponse(req.body.Entries));
      res.status(200).send();
    });
  }

  /**
   * Returns an EventBridge response as defined in the official documentation:
   * https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_PutEvents.html
   */
  generateEventBridgeResponse(entries) {
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
    const eventBuses = {};

    for (const key in Resources) {
      if (
        Object.prototype.hasOwnProperty.call(Resources, key) &&
        Resources[key].Type === "AWS::Events::EventBus"
      ) {
        eventBuses[key] = Resources[key].Properties.Name;
      }
    }

    return eventBuses;
  }

  invokeSubscribers(entries) {
    if (!entries) return [];
    this.log("checking event subscribers");

    const invoked = [];

    for (const entry of entries) {
      for (const { functionKey } of this.subscribers.filter((subscriber) =>
        this.verifyIsSubscribed(subscriber, entry)
      )) {
        invoked.push(this.invokeSubscriber(functionKey, entry));
      }
    }

    return invoked;
  }

  async invokeSubscriber(functionKey, entry, retry = 0) {
    const { retryDelayMs, maximumRetryAttempts: maxRetries } = this.options;
    const lambdaFunction = this.lambda.get(functionKey);
    const event = this.convertEntryToEvent(entry);
    lambdaFunction.setEvent(event);
    try {
      await lambdaFunction.runHandler();
      this.log(
        `${functionKey} successfully processed event with id ${event.id}`
      );
    } catch (err) {
      if (retry < maxRetries) {
        this.log(
          `error: ${err} occurred in ${functionKey} on ${retry}/${maxRetries}, will retry`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        await this.invokeSubscriber(functionKey, entry, retry + 1);
      }
      this.log(
        `error: ${err} occurred in ${functionKey} on attempt ${retry}, max attempts reached`
      );
      throw err;
    }
  }

  createLambda(lambdas) {
    this.lambda = new Lambda(this.serverless, this.options);
    this.lambda.create(lambdas);
  }

  verifyIsSubscribed(subscriber, entry) {
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
            "Source",
            subscriber.event.pattern.source
          )
        );
      }

      if (entry.DetailType && subscriber.event.pattern["detail-type"]) {
        subscribedChecks.push(
          this.verifyIfValueMatchesEventBridgePatterns(
            entry,
            "DetailType",
            subscriber.event.pattern["detail-type"]
          )
        );
      }

      if (entry.Detail && subscriber.event.pattern.detail) {
        const detail = JSON.parse(entry.Detail);

        const flattenedDetailObject = this.flattenObject(detail);
        const flattenedPatternDetailObject = this.flattenObject(
          subscriber.event.pattern.detail
        );

        // check for existence of every value in the pattern in the provided value
        for (const [key, value] of Object.entries(
          flattenedPatternDetailObject
        )) {
          subscribedChecks.push(
            this.verifyIfValueMatchesEventBridgePatterns(
              flattenedDetailObject,
              key,
              value
            )
          );
        }
      }
    }

    const subscribed = subscribedChecks.every((x) => x);
    this.log(
      `${subscriber.functionKey} ${subscribed ? "is" : "is not"} subscribed`
    );
    return subscribed;
  }

  verifyIfValueMatchesEventBridgePatterns(object, field, patterns) {
    if (!object) {
      return false;
    }

    let matchPatterns = patterns;
    if (!Array.isArray(matchPatterns)) {
      matchPatterns = [matchPatterns];
    }

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
  verifyIfValueMatchesEventBridgePattern(object, field, pattern) {
    // Simple scalar comparison
    if (typeof pattern !== "object") {
      if (!(field in object)) {
        return false; // Scalar vs non-existing field => false
      }
      if (Array.isArray(object[field])) {
        return object[field].includes(pattern);
      }
      return object[field] === pattern;
    }

    // "exists" filters
    if ("exists" in pattern) {
      return pattern.exists ? field in object : !(field in object);
    }

    if ("anything-but" in pattern) {
      return !this.verifyIfValueMatchesEventBridgePattern(
        object,
        field,
        pattern["anything-but"]
      );
    }

    // At this point, result is assumed false is the field does not actually exists
    if (!(field in object)) {
      return false;
    }

    const content = object[field];
    const filterType = Object.keys(pattern)[0];

    if (filterType === "prefix") {
      return content.startsWith(pattern.prefix);
    }

    // "numeric", and "cidr" filters and the recurring logic are yet supported by this plugin.
    throw new Error(
      `The ${filterType} eventBridge filter is not supported in serverless-offline-aws-eventBridge yet. ` +
        `Please consider submitting a PR to support it.`
    );
  }

  compareEventBusName(eventBus, eventBusName) {
    if (typeof eventBus === "string") {
      return eventBus.includes(eventBusName);
    }

    if (
      Object.prototype.hasOwnProperty.call(eventBus, "Ref") ||
      Object.prototype.hasOwnProperty.call(eventBus, "Fn::Ref") ||
      Object.prototype.hasOwnProperty.call(eventBus, "Fn::GetAtt")
    ) {
      const resourceName =
        eventBus.Ref || eventBus["Fn::Ref"] || eventBus["Fn::GetAtt"][0];

      if (this.eventBuses[resourceName]) {
        return (
          this.eventBuses[resourceName] &&
          this.eventBuses[resourceName].includes(eventBusName)
        );
      }
    }

    if (Object.prototype.hasOwnProperty.call(eventBus, "Fn::ImportValue")) {
      const importedResourceName = eventBus["Fn::ImportValue"];

      return (
        this.importedEventBuses[importedResourceName] &&
        this.importedEventBuses[importedResourceName].includes(eventBusName)
      );
    }

    return false;
  }

  getEvents() {
    const { service } = this.serverless;
    const functionKeys = service.getAllFunctions();
    const subscribers = [];
    const lambdas = [];
    const scheduleIntervals = [];

    for (const functionKey of functionKeys) {
      const functionDefinition = service.getFunction(functionKey);

      lambdas.push({ functionKey, functionDefinition });

      if (functionDefinition.events) {
        for (const event of functionDefinition.events) {
          if (event.eventBridge) {
            if (event.eventBridge.schedule !== undefined) {
              if (event.eventBridge.schedule.match(/^rate\(((1 (minute|hour|day))|([2-9][1-9]* (minutes|hours|days)))\)$/)) {
                const rate = event.eventBridge.schedule.slice(5, -1)
                const [periodInUnits, unit] = rate.split(" ");

                const unitToMilliseconds = {
                  minute: 60000,
                  minutes: 60000,
                  hour: 3600000,
                  hours: 3600000,
                  day: 86400000,
                  days: 86400000,
                }

                const eventBusName = "arn:aws:events:serverless-offline-aws-eventBridge:event-bus/schedule." + functionKey

                const periodInMilliseconds = periodInUnits * unitToMilliseconds[unit]
                scheduleIntervals.push(setInterval(async () => {
                  const invokedLambdas = this.invokeSubscribers([{
                    EventBusName: eventBusName,
                  }]);
                  if (invokedLambdas.length) {
                    await Promise.all(invokedLambdas);
                  }
                }, periodInMilliseconds))

                subscribers.push({
                  event: {
                    ...event.eventBridge,
                    eventBus: [...(event.eventBus || []), eventBusName],
                  }
                })
              } else {
                // e.g. cron expressions
                throw new Error(
                  `The schedule "${event.eventBridge.schedule}" is not supported in serverless-offline-aws-eventBridge yet. ` +
                    `Please consider submitting a PR to support it.`
                );
              }
            } else {
              subscribers.push({
                event: event.eventBridge,
                functionKey,
              });
            }
          }
        }
      }
    }

    return {
      subscribers,
      lambdas,
      scheduleIntervals,
    };
  }

  convertEntryToEvent(entry) {
    try {
      const event = {
        version: "0",
        id: `xxxxxxxx-xxxx-xxxx-xxxx-${new Date().getTime()}`,
        source: entry.Source,
        account: this.account,
        time: new Date().toISOString(),
        region: this.region,
        resources: entry.Resources || [],
        detail: JSON.parse(entry.Detail),
      };

      if (entry.DetailType) {
        event["detail-type"] = entry.DetailType;
      }

      return event;
    } catch (error) {
      this.log(
        `error converting entry to event: ${error.message}. returning entry instead`
      );
      return {
        ...entry,
        id: `xxxxxxxx-xxxx-xxxx-xxxx-${new Date().getTime()}`,
      };
    }
  }

  flattenObject(object, prefix = "") {
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

  log(message) {
    if (this.debug)
      this.serverless.cli.log(
        `serverless-offline-aws-eventbridge :: ${message}`
      );
  }
}

module.exports = ServerlessOfflineAwsEventbridgePlugin;
