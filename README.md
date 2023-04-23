# serverless-offline-aws-eventbridge
A serverless offline plugin that enables aws eventBridge events. As of version 1.4.0 this plugin also supports non javascript handlers.

[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)
[![npm version](https://badge.fury.io/js/serverless-offline-aws-eventbridge.svg)](https://badge.fury.io/js/serverless-offline-aws-eventbridge)
[![npm package](https://img.shields.io/npm/dm/serverless-offline-aws-eventbridge.svg)](https://www.npmjs.com/package/parcel-transformer-html-partials)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Docs
- [Installation](#installation)
- [Configure](#configure)
- [Usage](#usage)
- [Versions](#versions)
- [Thanks](#thanks)

## Installation

Install the plugin
```bash
npm install serverless-offline-aws-eventbridge --save
```

Note: if you are running Serverless-(offline) < 10 you need the a version < 2.0.0 of this package since the SLS offline and this eventbridge package were converted to a pure esm module that utilizes the exports functionality. See https://github.com/rubenkaiser/serverless-offline-eventBridge/issues/60

Let serverless know about the plugin, also note the order when combined with serverless webpack and offline
```YAML
plugins:
  - serverless-webpack
  - serverless-offline
  - serverless-offline-aws-eventbridge
```

Configuring the plugin

optional options shown with defaults
```YAML
custom:
  serverless-offline-aws-eventbridge:
    port: 4010 # port to run the eventBridge mock server on
    mockEventBridgeServer: true # Set to false if EventBridge is already mocked by another stack
    hostname: 127.0.0.1 # IP or hostname of existing EventBridge if mocked by another stack
    pubSubPort: 4011 # Port to run the MQ server (or just listen if using an EventBridge Mock server from another stack)
    debug: false # flag to show debug messages
    account: '' # account id that gets passed to the event
    maximumRetryAttempts: 10 # maximumRetryAttempts to retry lambda
    retryDelayMs: 500 # retry delay
    throwRetryExhausted: false # default true
    payloadSizeLimit: "10mb" # Controls the maximum payload size being passed to https://www.npmjs.com/package/bytes (Note: this payload size might not be the same size as your AWS Eventbridge receive)
```

## Publishing and subscribing

Checkout the documentation for AWS eventbridge in serverless framework and the AWS SDK for publishing and subscribing to events.

Scheduled events are also supported. When a cron fires the event object that is sent along is an empty object.

A simple example configuration in serverless with a Lambda function that publishes an event and a Lambda that subscribes to the event.

```YAML
functions:
  publishEvent:
    handler: events.publish
    events:
      - http:
          path: publish
          method: get

  consumeEvent:
    handler: events.consume
    events:
      - eventBridge:
          eventBus: marketing
          pattern:
            source:
              - acme.newsletter.campaign

  scheduledEvent:
    handler: events.scheduled
    events:
      - eventBridge:
          eventBus: marketing
          # run every 5 minutes
          schedule: "cron(0/5 * * * ? *)"
```


The events handler with two functions (publish and consume)

```javascript
  import AWS from 'aws-sdk';

  export const publish = async () => {
    try {
      const eventBridge = new AWS.EventBridge({
        endpoint: 'http://127.0.0.1:4010',
        accessKeyId: "YOURKEY",
        secretAccessKey: "YOURSECRET",
        region: "eu-west-1"
      });

      await eventBridge.putEvents({
        Entries: [
          {
            EventBusName: 'marketing',
            Source: 'acme.newsletter.campaign',
            DetailType: 'UserSignUp',
            Detail: `{ "E-Mail": "some@someemail.some" }`,
          },
        ]
      }).promise();
      return { statusCode: 200, body: 'published' };
    } catch (e) {
      console.error(e);
      return { statusCode: 400, body: 'could not publish' };
    }
  }

  export const consume = async (event, context) => {
    console.log(event);
    /*
      {
        EventBusName: 'marketing',
        Source: 'acme.newsletter.campaign',
        DetailType: 'UserSignUp',
        Detail: `{ "E-Mail": "some@someemail.some" }`,
      }
    */
    return { statusCode: 200, body: JSON.stringify(event) };
  }

  export const scheduled = async (event, context) => {
    console.log('scheduled event');
    return { statusCode: 200, body: 'scheduled event' };
  }
```
## Support of EventBridge patterns

EventBridge natively allows a few content-based filters defined here:
https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns-content-based-filtering.html

This plugin supports the most common patterns:
* `prefix`
* `anything-but`
* `exists`

```yaml
functions:
  consumeEvent:
    handler: events.consume
    events:
      - eventBridge:
          eventBus: marketing
          pattern:
            source:
              - user
            detail-type:
              - { "anything-but": "deleted" }
            detail:
              firstname: [ { "prefix": "John" } ]
              age: [ { "exists": true } ]
```

The `cidr` and `numeric` filters are yet to be implemented.

## Using CloudFormation intrinsic functions

At some point you might want to use an existing event bus. This plugin needs to somehow resolve intrinsic CloudFormation function calls to event bus names/arns.

An event bus created by the same template, will be referenced using the `!GetAtt` function:

```YAML
functions:

  consumeEvent:
    handler: events.consume
    events:
      - eventBridge:
          eventBus: !GetAtt EventBus.Arn
```

This plugin will look for an `EventBus` resource of type `AWS::Events::EventBus` when deciding whether a function must be triggered.

Or you might use `!ImportValue` to reference an event bus created by another stack.

```YAML
functions:

  consumeEvent:
    handler: events.consume
    events:
      - eventBridge:
          eventBus: !ImportValue EventBusNameFromOtherStack
```

In this case, you won't define the resource directly in your template. To overcome this limitation, you can define a custom object in `serverless.yml` that indicates the mapping between imported keys and the actual event bus name/arn:

```YAML
custom:
  serverless-offline-aws-eventbridge:
    port: 4010 # port to run the eventBridge mock server on
    mockEventBridgeServer: true # Set to false if EventBridge is already mocked by another stack
    hostname: 127.0.0.1 # IP or hostname of existing EventBridge if mocked by another stack
    pubSubPort: 4011 # Port to run the MQ server (or just listen if using an EventBridge mock server from another stack)
    debug: false # flag to show debug messages
    account: '' # account id that gets passed to the event
    imported-event-buses:
      EventBusNameFromOtherStack: event-bus-name-or-arn
```

If your existing EventBridge is mocked on a different host/IP (e.g. When stacks are hosted in Docker containers), then you will also need to specify a `hostname`. If using Docker, you should use the name of the container that mocks the EventBridge (assuming both containers are on the same Docker network).

## Localstack
Plugin is capable of working against locally running docker container of localstack. For example look in [sns-sqs-lambda](examples/typescript//localstack//sns-sqs-lambda/README.md)

**IMPORTANT**
Right now you can run this plugin in "mock server" mode or in localstack mode. By configuring localstack section in your config mock server will not be running.

To configure localstack add configuration:
```YAML
custom:
  serverless-offline-aws-eventbridge:
    localStackConfig:
      localStackEndpoint: http://localhost:4566
```

Or in TypeScript
```typescript
'serverless-offline-aws-eventbridge': {
      localStackConfig: {
        localStackEndpoint: 'http://localhost:4566',
      },
    }
```

For complete guide look in to [TypeScript Localstack example](./examples//typescript//localstack/sns-sqs-lambda).

### Currently supported targets
- [SNS](./examples//typescript//localstack//sns-sqs-lambda//README.md#L7)

## Examples

Two stacks are provided as example:
* `same-stack-publisher-subscriber` runs a mock of Eventbridge. It also has a local (same stack) subscriber
* `remote-subscriber` is a completely independent microservice listening to the eventBridge mock created by the `same-stack-publisher-subscriber` stack

1) Run the first stack in a terminal
```bash
cd examples/same-stack-publisher-subscriber
npm i
serverless offline start
```
2) Run the second stack in a different terminal
```bash
cd examples/remote-subscriber
npm i
serverless offline start
```

3) Publish a test message

Simply hit the exposed API gateway endpoint: http://localhost:3016/dev/publish

You should see the message received on both stacks in the terminal output. You will also notice that the socket connection is resilient to crashes: everything works smoothly as soon as both offline stacks are up and running, regardless of which stack has been restarted last.


## Thanks
This plugin was inspired by the serverless-offline-sns plugin. Also thanks to @sndpl, @guavajellyaaron, @rloomans, @JamesKyburz, @plumsirawit, @damien-thiesson, @carrickkv2 and @dnalborczyk for their work and PR's.
