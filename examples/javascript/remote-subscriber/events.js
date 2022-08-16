exports.consume = async (event) => {
  console.log(`Remote Eventbridge event received:`, event);
  return { statusCode: 200, body: JSON.stringify(event) };
};
