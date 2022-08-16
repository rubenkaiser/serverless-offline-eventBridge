import json
from typing import Generic, TypeVar

FakeLambdaContext = TypeVar('FakeLambdaContext')


def consume(event: dict, context: Generic[FakeLambdaContext]):
    """
    Consumes an incoming event and returns.
    """
    print(f"Remote Eventbridge event received: {event}")
    return {"statusCode": 200, "body": json.dumps(event)}
