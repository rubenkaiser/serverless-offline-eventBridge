"use strict";

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
// eslint-disable-next-line import/no-unresolved
const Lambda = require("serverless-offline/dist/lambda").default;

class ServerlessOfflineAwsEventbridgePlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.lambda = null;
    this.options = options;
    this.config = null;
    this.port = null;
    this.account = null;
    this.debug = null;
    this.eventBridgeServer = null;
    this.location = null;

    this.subscribers = [];
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
    this.eventBridgeServer = this.app.listen(this.port);
  }

  async stop() {
    this.init();
    this.log("stop");
    this.eventBridgeServer.close();
    if (this.lambda) await this.lambda.cleanup();
  }

  init() {
    this.config =
      this.serverless.service.custom["serverless-offline-aws-eventbridge"] ||
      {};
    this.port = this.config.port || 4010;
    this.account = this.config.account || "";
    this.region = this.serverless.service.provider.region || "us-east-1";
    this.debug = this.config.debug || false;

    const {
      service: { custom = {}, provider },
    } = this.serverless;

    const offlineOptions = custom["serverless-offline"];
    const offlineEventBridgeOptions =
      custom["serverless-offline-aws-eventbridge"];

    this.options = {
      ...this.options,
      ...provider,
      ...offlineOptions,
      ...offlineEventBridgeOptions,
    };

    const { subscribers, lambdas } = this.getEvents();

    this.createLambda(lambdas);
    this.subscribers = subscribers;

    // initialise the express app
    this.app = express();
    this.app.use(cors());
    this.app.use(bodyParser.json({ type: "application/x-amz-json-1.1" }));
    this.app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));
    this.app.use((req, res, next) => {
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
      if (req.body.Entries) {
        const eventResults = [];
        this.log("checking event subscribers");
        await Promise.all(
          req.body.Entries.map(async (entry) => {
            this.subscribers
              .filter((subscriber) =>
                this.verifyIsSubscribed(subscriber, entry)
              )
              .map(async ({ functionKey }) => {
                const lambdaFunction = this.lambda.get(functionKey);
                const event = this.convertEntryToEvent(entry);
                lambdaFunction.setEvent(event);
                try {
                  await lambdaFunction.runHandler();
                  this.log(`successfully processes event with id ${event.id}`);
                  eventResults.push({
                    eventId:
                      event.id ||
                      `xxxxxxxx-xxxx-xxxx-xxxx-${new Date().getTime()}`,
                  });
                } catch (err) {
                  this.log(`Error: ${err}`);
                  eventResults.push({
                    eventId:
                      event.id ||
                      `xxxxxxxx-xxxx-xxxx-xxxx-${new Date().getTime()}`,
                    ErrorCode: "code",
                    ErrorMessage: "message",
                  });
                }
              });
          })
        );
        res.json({
          Entries: eventResults,
          FailedEntryCount: eventResults.filter((e) => e.ErrorCode).length,
        });
      } else {
        res.status(200).send();
      }
    });
  }

  createLambda(lambdas) {
    this.lambda = new Lambda(this.serverless, this.options);
    this.lambda.create(lambdas);
  }

  verifyIsSubscribed(subscriber, entry) {
    const subscribedChecks = [];

    if (subscriber.event.eventBus && entry.EventBusName) {
      subscribedChecks.push(
        subscriber.event.eventBus.includes(entry.EventBusName)
      );
    }

    if (subscriber.event.pattern) {
      if (subscriber.event.pattern.source) {
        subscribedChecks.push(
          subscriber.event.pattern.source.includes(entry.Source)
        );
      }

      if (entry.DetailType && subscriber.event.pattern["detail-type"]) {
        subscribedChecks.push(
          subscriber.event.pattern["detail-type"].includes(entry.DetailType)
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
            flattenedDetailObject[key]
              ? value.includes(flattenedDetailObject[key])
              : false
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

  getEvents() {
    const { service } = this.serverless;
    const functionKeys = service.getAllFunctions();
    const subscribers = [];
    const lambdas = [];

    for (const functionKey of functionKeys) {
      const functionDefinition = service.getFunction(functionKey);

      lambdas.push({ functionKey, functionDefinition });

      if (functionDefinition.events) {
        for (const event of functionDefinition.events) {
          if (event.eventBridge && !event.eventBridge.schedule) {
            subscribers.push({
              event: event.eventBridge,
              functionKey,
            });
          }
        }
      }
    }

    return {
      subscribers,
      lambdas,
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
        resources: [],
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
        value && value instanceof Object && !(value instanceof Date)
          ? {
              ...accumulator,
              ...this.flattenObject(value, (prefix && prefix + ".") + key),
            }
          : { ...accumulator, [(prefix && prefix + ".") + key]: value },
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
