# serverless-offline-aws-eventbridge
A serverless offline plugin that enables aws eventBridge events. As of version 1.4.0 this plugin also supports non javascript handlers.

[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)
[![npm version](https://badge.fury.io/js/serverless-offline-aws-eventbridge.svg)](https://badge.fury.io/js/serverless-offline-aws-eventbridge)
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
    port: 4010 # port to run the eventbridge mock server on
    debug: false # flag to show debug messages
    account: '' # account id that gets passed to the event
    maximumRetryAttempts: 10 # maximumRetryAttempts to retry lambda
    retryDelayMs: 500 # retry delay
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
    port: 4010 # port to run the eventbridge mock server on
    debug: false # flag to show debug messages
    account: '' # account id that gets passed to the event
    imported-event-buses:
      EventBusNameFromOtherStack: event-bus-name-or-arn
```

## Versions
This plugin was created using node 12.16.1 and serverless framework core 1.67.0.

## Thanks
This plugin was inspired by the serverless-offline-sns plugin. Also thanks to @sndpl, @guavajellyaaron, @rloomans, @JamesKyburz and @plumsirawit for their PR's.
