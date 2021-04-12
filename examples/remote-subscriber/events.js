// eslint-disable-next-line import/no-extraneous-dependencies

exports.consume = async (event, context) => {
  console.log(`Remote Eventbridge event received:`, event);
  /*
      {
        EventBusName: 'marketing',
        Source: 'acme.newsletter.campaign',
        DetailType: 'UserSignUp',
        Detail: `{ "E-Mail": "some@someemail.some" }`,
      }
    */
  return { statusCode: 200, body: JSON.stringify(event) };
};
