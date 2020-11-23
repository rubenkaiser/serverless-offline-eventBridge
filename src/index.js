"use strict";

const express = require("express");
const cron = require("node-cron");
const cors = require("cors");
const bodyParser = require("body-parser");
const { resolve } = require("path");
const { spawn } = require("child_process");

class ServerlessOfflineAwsEventbridgePlugin {
  constructor(serverless, options) {
    this.log("construct");
    this.serverless = serverless;
    this.options = options;
    this.config = null;
    this.port = null;
    this.account = null;
    this.debug = null;
    this.eventBridgeServer = null;
    this.location = null;

    this.nonScheduled = [];
    this.scheduled = [];
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

  stop() {
    this.init();
    this.log("stop");
    this.eventBridgeServer.close();
  }

  init() {
    this.config =
      this.serverless.service.custom["serverless-offline-aws-eventbridge"] ||
      {};
    this.port = this.config.port || 4010;
    this.account = this.config.account || "";
    this.region = this.serverless.service.provider.region || "us-east-1";
    this.debug = this.config.debug || false;
    const offlineConfig =
      this.serverless.service.custom["serverless-offline"] || {};

    this.location = process.cwd();
    const locationRelativeToCwd =
      this.options.location || offlineConfig.location;
    if (locationRelativeToCwd) {
      this.location = `${process.cwd()}/${locationRelativeToCwd}`;
    } else if (this.serverless.config.servicePath) {
      this.location = this.serverless.config.servicePath;
    }

    const subscriptions = this.getSubscriptions(
      this.serverless.service.functions
    );

    this.nonScheduled = subscriptions.nonScheduled;
    this.scheduled = subscriptions.scheduled;

    // loop the scheduled events and create a cron for them
    this.scheduled.forEach((scheduledEvent) => {
      this.serverless.cli.log(
        `serverless-offline-aws-eventbridge ::`,
        `scheduling ${scheduledEvent.functionName} with cron ${scheduledEvent.schedule}`
      );
      cron.schedule(scheduledEvent.schedule, async () => {
        if (this.debug) {
          this.log(
            `serverless-offline-aws-eventbridge ::`,
            `run scheduled function ${scheduledEvent.functionName}`
          );
        }
        const handler = this.createHandler(
          scheduledEvent.functionName,
          scheduledEvent.function
        );
        await handler()({}, {}, (err, success) => {
          if (err) {
            this.log(`Error: ${err}`);
          } else {
            this.log(`Success:`, success);
          }
        });
      });
    });

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
            this.nonScheduled
              .filter((subscriber) =>
                this.verifyIsSubscribed(subscriber, entry)
              )
              .map(async (subscriber) => {
                const handler = this.createHandler(
                  subscriber.functionName,
                  subscriber.function
                );
                const event = this.convertEntryToEvent(entry);

                try {
                  await handler()(event, {});
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

    // const endpoint = `http://127.0.0.1:${this.port}`;
    // AWS.config.eventBridge = {
    //   endpoint,
    //   accessKeyId: this.config.accessKeyId || 'YOURKEY',
    //   secretAccessKey: this.config.secretAccessKey || 'YOURSECRET',
    //   region: this.region
    // };
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

        // if the length of the two doesn't match push a false in the subscription
        if (
          Object.keys(flattenedPatternDetailObject).length !==
          Object.keys(flattenedDetailObject).length
        ) {
          subscribedChecks.push(false);
        } else {
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
    }

    const subscribed = subscribedChecks.every((x) => x);
    this.log(
      `${subscriber.functionName} ${subscribed ? "is" : "is not"} subscribed`
    );
    return subscribed;
  }

  getSubscriptions(functions) {
    // build the list of subscribers, nonScheduled and scheduled
    const nonScheduled = [];
    const scheduled = [];

    Object.keys(functions).forEach((fnName) => {
      const fn = functions[fnName];
      if (fn.events) {
        fn.events
          .filter((event) => event.eventBridge != null)
          .forEach((event) => {
            if (event.eventBridge.schedule) {
              let convertedSchedule;

              if (event.eventBridge.schedule.indexOf("rate") > -1) {
                const rate = event.eventBridge.schedule
                  .replace("rate(", "")
                  .replace(")", "");

                const parts = rate.split(" ");

                if (parts[1]) {
                  if (parts[1].startsWith("minute")) {
                    convertedSchedule = `*/${parts[0]} * * * *`;
                  } else if (parts[1].startsWith("hour")) {
                    convertedSchedule = `0 */${parts[0]} * * *`;
                  } else if (parts[1].startsWith("day")) {
                    convertedSchedule = `0 0 */${parts[0]} * *`;
                  } else {
                    this.log(
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
                convertedSchedule = convertedSchedule.split("?").join("*");
              }
              if (convertedSchedule) {
                scheduled.push({
                  schedule: convertedSchedule,
                  functionName: fnName,
                  function: fn,
                });
                this.log(
                  `Scheduled '${fnName}' with syntax ${convertedSchedule}`
                );
              } else {
                this.log(
                  `Invalid schedule syntax '${event.eventBridge.schedule}', will not schedule`
                );
              }
            } else {
              nonScheduled.push({
                event: event.eventBridge,
                functionName: fnName,
                function: fn,
              });
            }
          });
      }
    });

    return {
      nonScheduled,
      scheduled,
    };
  }

  createHandler(fnName, fn) {
    if (!fn.runtime || fn.runtime.startsWith("nodejs")) {
      return this.createJavascriptHandler(fn);
    }
    return () => this.createProxyHandler(fnName, fn);
  }

  createProxyHandler(funName, funOptions) {
    const { options } = this;
    return (event, context) => {
      const args = ["invoke", "local", "-f", funName];
      const stage = options.s || options.stage;

      if (stage) {
        args.push("-s", stage);
      }

      const cmd = "sls";

      const process = spawn(cmd, args, {
        cwd: funOptions.servicePath,
        shell: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      process.stdin.write(`${JSON.stringify(event)}\n`);
      process.stdin.end();

      const results = [];
      let error = false;

      process.stdout.on("data", (data) => {
        if (data) {
          const str = data.toString();
          if (str) {
            // should we check the debug flag & only log if debug is true?
            this.log(str);
            results.push(data.toString());
          }
        }
      });

      process.stderr.on("data", (data) => {
        error = true;
        console.warn("error", data);
        context.fail(data);
      });

      process.on("close", () => {
        if (!error) {
          let response = null;
          // eslint-disable-next-line no-plusplus
          for (let i = results.length - 1; i >= 0; i--) {
            const item = results[i];
            const firstCurly = item.indexOf("{");
            const firstSquare = item.indexOf("[");
            let start = 0;
            let end = item.length;
            if (firstCurly === -1 && firstSquare === -1) {
              // no json found
              // eslint-disable-next-line no-continue
              continue;
            }
            if (firstSquare === -1 || firstCurly < firstSquare) {
              // found an object
              start = firstCurly;
              end = item.lastIndexOf("}") + 1;
            } else if (firstCurly === -1 || firstSquare < firstCurly) {
              // found an array
              start = firstSquare;
              end = item.lastIndexOf("]") + 1;
            }

            try {
              response = JSON.parse(item.substring(start, end));
              break;
            } catch (err) {
              // not json, check the next one
              // eslint-disable-next-line no-continue
              continue;
            }
          }
          if (response !== null) {
            context.succeed(response);
          } else {
            context.succeed(results.join("\n"));
          }
        }
      });
    };
  }

  createJavascriptHandler(fn) {
    return () => {
      const handlerFnNameIndex = fn.handler.lastIndexOf(".");
      const handlerPath = fn.handler.substring(0, handlerFnNameIndex);
      const handlerFnName = fn.handler.substring(handlerFnNameIndex + 1);
      const fullHandlerPath = resolve(this.location, handlerPath);
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const handler = require(fullHandlerPath)[handlerFnName];
      return handler;
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

  flattenObject(obj) {
    const flattened = {};
    for (const i in obj) {
      // eslint-disable-next-line no-prototype-builtins
      if (!obj.hasOwnProperty(i)) {
        if (typeof obj[i] === "object" && !Array.isArray(obj[i])) {
          const flatObject = this.flattenObject(obj[i]);
          for (const x in flatObject) {
            // eslint-disable-next-line no-prototype-builtins
            if (!flatObject.hasOwnProperty(x))
              flattened[`${i}.${x}`] = flatObject[x];
          }
        } else {
          flattened[i] = obj[i];
        }
      }
    }
    return flattened;
  }

  log(message) {
    if (this.debug)
      this.serverless.cli.log(
        `serverless-offline-aws-eventbridge :: ${message}`
      );
  }
}

module.exports = ServerlessOfflineAwsEventbridgePlugin;
