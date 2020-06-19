# serverless-offline-aws-eventbridge
A serverless offline plugin that enables aws eventBridge events

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

```YAML
custom:
  serverless-offline-aws-eventbridge:
    port: 4010 # port to run the eventbridge mock server on
    debug: false # flag to show debug messages
    account: '' # account id that gets passed to the event
    convertEntry: false # flag to convert entry to match cloudwatch
```

## Publishing and subscribing

Checkout the documentation for AWS eventbridge in serverless framework and the AWS SDK for publishing and subscribing to events. Note that in this plugin scheduling does not work. Only regular subscribers to a custom eventBus is provided.

A simple example configuration in serverless with a Lambda function that publishes an event and a Lambda that subscribes to the event. (example coming soon)

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

      * If 'convertEntry' flag is true, out output will be
      {
        version: "0",
        id: "xxxxxxxx-xxxx-xxxx-xxxx-1234443234563",
        source: "acme.newsletter.campaign",
        account: "",
        time: "2020-06-19T16:37:00Z",
        region: "us-east-1",
        resources: [],
        detail: {
          { 
            "E-Mail": "some@someemail.some" 
          }
        }
      }
    */
    return { statusCode: 200, body: JSON.stringify(event) };
  }
```

## Versions
This plugin was created using node 12.16.1 and serverless framework core 1.67.0.

## Thanks
This plugin was inspired by the serverless-offline-sns plugin