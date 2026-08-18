from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.iot_core.event_hub import get_event_hub

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/events")
async def ws_events(websocket: WebSocket) -> None:
    await websocket.accept()
    hub = get_event_hub()
    queue = await hub.subscribe()
    sender_task: asyncio.Task[None] | None = None
    receiver_task: asyncio.Task[None] | None = None
    try:
        await websocket.send_json({"type": "connected", "channel": "events"})

        async def sender() -> None:
            while True:
                event = await queue.get()
                await websocket.send_json(event)

        async def receiver() -> None:
            # Client pings keep the socket alive; must not cancel sender/queue.get.
            while True:
                await websocket.receive_text()

        sender_task = asyncio.create_task(sender())
        receiver_task = asyncio.create_task(receiver())
        done, pending = await asyncio.wait(
            {sender_task, receiver_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        for task in done:
            exc = task.exception()
            if exc and not isinstance(exc, (asyncio.CancelledError, WebSocketDisconnect)):
                raise exc
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if sender_task is not None:
            sender_task.cancel()
        if receiver_task is not None:
            receiver_task.cancel()
        await hub.unsubscribe(queue)
