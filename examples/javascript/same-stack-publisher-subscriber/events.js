// eslint-disable-next-line import/no-extraneous-dependencies
const AWS = require('aws-sdk');

exports.publish = async () => {
  try {
    const eventBridge = new AWS.EventBridge({
      endpoint: 'http://127.0.0.1:4080',
      accessKeyId: 'YOURKEY',
      secretAccessKey: 'YOURSECRET',
      region: 'eu-west-1',
    });

    const params = {
      Entries: [
        {
          EventBusName: 'marketing',
          Source: 'acme.newsletter.campaign',
          DetailType: 'UserSignUp',
          Detail: `{ "E-Mail": "some@someemail.some" }`,
        },
      ],
    };

    await eventBridge.putEvents(params).promise();
    return { statusCode: 200, body: 'published' };
  } catch (e) {
    console.error(e);
    return { statusCode: 400, body: 'could not publish' };
  }
};

exports.consume = async (event) => {
  console.log(`Local Eventbridge event received:`, event);
  return { statusCode: 200, body: JSON.stringify(event) };
};
