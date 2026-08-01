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
    try:
        await websocket.send_json({"type": "connected", "channel": "events"})
        while True:
            # Also detect client disconnect via receive with timeout interleaved
            get_task = asyncio.create_task(queue.get())
            recv_task = asyncio.create_task(websocket.receive_text())
            done, pending = await asyncio.wait(
                {get_task, recv_task}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            if get_task in done:
                event = get_task.result()
                await websocket.send_json(event)
            if recv_task in done:
                # Client ping/message — ignore payload; disconnect raises
                _ = recv_task.result()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await hub.unsubscribe(queue)
