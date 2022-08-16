import boto3
from typing import Generic, TypeVar

FakeLambdaContext = TypeVar('FakeLambdaContext')


def publish_event(event: dict, context: Generic[FakeLambdaContext]):
    """
    Puts an event in eventbridge.
    """

    eventbridge = boto3.client("events", endpoint_url="http://127.0.0.1:4080")

    try:

        eventbridge.put_events(
            Entries=[
                {
                    "EventBusName": "marketing",
                    "Source": "acme.newsletter.campaign",
                    "DetailType": "UserSignUp",
                    "Detail": f'E-Mail: some@someemail.some'
                }
            ]
        )

        return {"statusCode": 200, "body": "published"}

    except eventbridge.exceptions.InternalException as e:
        print(f'Error: {e}')
        return {"statusCode": 400, "body": "could not publish"}
