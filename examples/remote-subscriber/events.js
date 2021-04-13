// eslint-disable-next-line import/no-extraneous-dependencies

exports.consume = async (event, context) => {
  console.log(`Remote Eventbridge event received:`, event);
  return { statusCode: 200, body: JSON.stringify(event) };
};
