# Serverless EventBridge Offline Example
This example has been generated with ```console npx serverless create --template aws-nodejs-typescript --path sns-sqs-lambda```

# Localstack integration
This example presents how to integrate with localstack docker on your machine. It does not perform deployment. All it does is creates resources in docker and makes requests against it.

## Available integrations
Currently localstack integration [handles targets](../../../../src/integrations/localstack/targets/target-handlers):
- [SNS](../../../../src/integrations/localstack/targets/target-handlers/sns-target-handler.ts)

[Other handlers are not yet implemented](../../../../src/integrations/localstack/targets/create-targets.ts#L98).

## Scenario
This example covers scenario of integrating **EventBridge -> SNS -> SQS -> Lambda**.
Why like this? EventBridge rules are limited to 300 and each rule targets are limited to 5. Which are serious limitations.
Usually developers get around them by adding SNS as target since SNS does not have such a limitation and can send message to as many subscribers as it wants to.

Integrations between SNS -> SQS -> Lambda are achieved with use of offline plugins:
- [serverless-offline-sns](package.json#L23)
- [serverless-offline-sqs-external](package.json#L24)

## Docker
Look in to [docker-compose.yml](docker-compose.yml) for example of localstack configuration.

## Serverless TypeScript
Example is provided in TypeScript so look for [serverless.ts](serverless.ts) file not serverless.yaml

# How to test
## Prerequisites
- docker / podman
- NodeJS 14+

## Build plugin from root of serverless-offline-aws-eventbridge
This example is looking for output of plugin build. You can check it in [serverless.ts](serverless.ts#L18)
In root of [serverless-offline-aws-eventbridge](../../../../README.md) make sure to perform
```console npm install```
```console npm run build```

## Install dependencies
execute ```console npm install``` in root of this example.

## Start localstack
execute ```console docker-compose up``` in foot of this example. It will look for [docker-compose.yml](docker-compose.yml) by default.

## Start Serverless Offline
execute [```npm start```](package.json#L7) in root of this example.

## Run test script
execute [```npm test```](package.json#L9) in root of this example.
[Test script](test/test-script.ts)

You should be able to see output from server
![Serverless Offline Output](assets/output%20from%20test.png?raw=true "Serverless Offline Output")
This is output from your [lambda](src/functions/hello/handler.ts#L9).

And from running test in other terminal window
![Test output](assets/test%20run.png?raw=true "Test output")
