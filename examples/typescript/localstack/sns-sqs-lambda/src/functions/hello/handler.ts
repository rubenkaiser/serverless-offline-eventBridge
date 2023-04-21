/* eslint-disable no-console */
import { Callback, Context, Handler, SQSEvent } from 'aws-lambda';

const hello: Handler<SQSEvent, any> = async (
  event: SQSEvent,
  _context: Context,
  _callback: Callback
) => {
  console.log('Your event reaching Hello lambda', event);
  return event;
};

export const main = hello;
