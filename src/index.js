'use strict';
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { resolve } = require('path');
const { spawn } = require('child_process');

class ServerlessOfflineAwsEventbridgePlugin {
  constructor(serverless, options) {
    this.log('construct');
    this.serverless = serverless;
    this.options = options;
    this.config = null;
    this.port = null;
    this.account = null;
    this.convertEntry = null;
    this.debug = null;
    this.eventBridgeServer = null;
    this.location = null;
    this.subscribers = null;

    this.app = express();
    this.app.use(cors());
    this.app.use(bodyParser.json({ type: 'application/x-amz-json-1.1'}));
    this.app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Content-Length, ETag, X-CSRF-Token, Content-Disposition');
      res.header('Access-Control-Allow-Methods', 'PUT, POST, GET, DELETE, HEAD, OPTIONS');
      next();
    });
    this.app.all('*', async (req, res) => {
      if (req.body.Entries) {
        this.log('checking event subscribers');
        Promise.all(
          req.body.Entries.map(async entry => {
            this.subscribers.filter(subscriber => this.verifyIsSubscribed(subscriber, entry))
              .map(async subscriber => {
                const handler = this.createHandler(subscriber.functionName, subscriber.function);
                const event = this.convertEntryToEvent(entry);
                await handler()(event, {}, (err, success) => {
                  if (this.debug) {
                    if (err) {
                      this.serverless.cli.log(`serverless-offline-aws-eventbridge ::`, `Error:`, err)
                    } else {
                      this.serverless.cli.log(`serverless-offline-aws-eventbridge ::`, success)
                    }
                  }
                });
            });
          })
        );
      }
      res.status(200).send();
    });

    this.hooks = {
      'before:offline:start': () => this.start(),
      'before:offline:start:init': () => this.start(),
      'after:offline:start:end': () => this.stop(),
    };
  }
  
  async start() {
    this.log('start');
    this.init();
    this.eventBridgeServer = this.app.listen(this.port);
  }

  stop() {
    this.init();
    this.log('stop');
    this.eventBridgeServer.close();
  }

  init() {
    this.config = this.serverless.service.custom['serverless-offline-aws-eventbridge'] || {};
    this.port = this.config.port || 4010;
    this.account = this.config.account || '';
    this.convertEntry = this.config.convertEntry || false;
    this.region = this.serverless.service.provider.region || 'us-east-1';
    this.debug = this.config.debug || false;
    const offlineConfig = this.serverless.service.custom['serverless-offline'] || {};

    this.location = process.cwd();
    const locationRelativeToCwd = this.options.location || offlineConfig.location;
    if (locationRelativeToCwd) {
      this.location = process.cwd() + '/' + locationRelativeToCwd;
    } else if (this.serverless.config.servicePath) {
      this.location = this.serverless.config.servicePath;
    }

    // const endpoint = `http://127.0.0.1:${this.port}`;
    // AWS.config.eventBridge = {
    //   endpoint,
    //   accessKeyId: this.config.accessKeyId || 'YOURKEY',
    //   secretAccessKey: this.config.secretAccessKey || 'YOURSECRET',
    //   region: this.region
    // };

    const subscribers = [];
    Object.keys(this.serverless.service.functions).map(fnName => {
      const fn = this.serverless.service.functions[fnName];
      if (fn.events) {
        fn.events.filter(event => event.eventBridge != null).map(event => {
          subscribers.push({ event: event.eventBridge, functionName: fnName, function: fn });
        });
      }
    });
    this.subscribers = subscribers;
  }
  
  verifyIsSubscribed(subscriber, entry) {
    // Match EventBusName and Source by default
    const subscribedChecks = [
      subscriber.event.eventBus.includes(entry.EventBusName), 
      subscriber.event.pattern.source.includes(entry.Source)
    ]

    if (entry.DetailType && subscriber.event.pattern['detail-type']) {
      subscribedChecks.push(subscriber.event.pattern['detail-type'].includes(entry.DetailType));
    }

    if (entry.Detail && subscriber.event.pattern['detail']) {
      const detail = JSON.parse(entry.Detail)
      Object.keys(subscriber.event.pattern['detail']).forEach((key) => {
        subscribedChecks.push(subscriber.event.pattern['detail'][key].includes(detail[key]))
      }) 
    }
    
    const subscribed = subscribedChecks.every(x => x);
    this.log(`${subscriber.functionName} ${subscribed ? 'is' : 'is not'} subscribed`);
    return subscribed;
  }

  createHandler(fnName, fn) {
    if (!fn.runtime || fn.runtime.startsWith('nodejs')) {
      return this.createJavascriptHandler(fn);
    } else {
      return this.createProxyHandler(fnName, fn);
    }
  }

  createProxyHandler(funName, funOptions) {
    const options = this.options;
    return (event, context) => {
      const args = ['invoke', 'local', '-f', funName];
      const stage = options.s || options.stage;

      if (stage) {
        args.push('-s', stage);
      }

      const cmd = 'sls';

      const process = spawn(cmd, args, {
        cwd: funOptions.servicePath,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      process.stdin.write(`${JSON.stringify(event)}\n`);
      process.stdin.end();

      const results = [];
      let error = false;

      process.stdout.on('data', (data) => {
        if (data) {
          const str = data.toString();
          if (str) {
            // should we check the debug flag & only log if debug is true?
            console.log(str);
            results.push(data.toString());
          }
        }
      });

      process.stderr.on('data', data => {
        error = true;
        console.warn('error', data);
        context.fail(data);
      });

      process.on('close', code => {
        if (!error) {
          let response = null;
          for (let i = results.length - 1; i >= 0; i--) {
            const item = results[i];
            const firstCurly = item.indexOf('{');
            const firstSquare = item.indexOf('[');
            let start = 0;
            let end = item.length;
            if (firstCurly === -1 && firstSquare === -1) {
              // no json found
              continue;
            }
            if (firstSquare === -1 || firstCurly < firstSquare) {
              // found an object
              start = firstCurly;
              end = item.lastIndexOf('}') + 1;
            } else if (firstCurly === -1 || firstSquare < firstCurly) {
              // found an array
              start = firstSquare;
              end = item.lastIndexOf(']') + 1;
            }

            try {
              response = JSON.parse(item.substring(start, end));
              break;
            } catch (err) {
              // not json, check the next one
              continue;
            }
          }
          if (response !== null) {
            context.succeed(response);
          } else {
            context.succeed(results.join('\n'));
          }
        }
      });
    };
  }

  createJavascriptHandler(fn) {
    return () => {
      const handlerFnNameIndex = fn.handler.lastIndexOf('.');
      const handlerPath = fn.handler.substring(0, handlerFnNameIndex);
      const handlerFnName = fn.handler.substring(handlerFnNameIndex + 1);
      const fullHandlerPath = resolve(this.location, handlerPath);
      const handler = require(fullHandlerPath)[handlerFnName];
      return handler;
    };
  }

  convertEntryToEvent(entry) {
    if (!this.convertEntry) {
      return entry;
    }

    try {
      const event = {
        version: '0',
        id: `xxxxxxxx-xxxx-xxxx-xxxx-${new Date().getTime()}`,
        source: entry.Source,
        account: this.account,
        time: new Date().toISOString(),
        region: this.region,
        resources: [],
        detail: JSON.parse(entry.Detail)
      }
  
      if (entry.DetailType) {
        event['detail-type'] = entry.DetailType;
      }
  
      return event;
    } catch (error) {
      this.log(`error converting entry to event: ${error.message}. returning entry instead`);
      return entry;
    }
  }

  log(message) {
    if (this.debug) this.serverless.cli.log(`serverless-offline-aws-eventbridge :: ${message}`);
  }
}

module.exports = ServerlessOfflineAwsEventbridgePlugin;
