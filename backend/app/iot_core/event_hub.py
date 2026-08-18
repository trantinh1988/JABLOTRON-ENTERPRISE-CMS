from __future__ import annotations

import asyncio
import json
from collections.abc import Callable, Coroutine
from datetime import datetime, timezone
from typing import Any

EventHandler = Callable[[dict[str, Any]], Coroutine[Any, Any, None]]


class EventHub:
    """In-memory pub/sub for WebSocket clients and internal listeners."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._handlers: list[EventHandler] = []
        self._lock = asyncio.Lock()

    def add_handler(self, handler: EventHandler) -> None:
        self._handlers.append(handler)

    async def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1024)
        async with self._lock:
            self._subscribers.add(queue)
        return queue

    async def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            self._subscribers.discard(queue)

    async def publish(self, event: dict[str, Any]) -> None:
        if "ts" not in event:
            event = {**event, "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}

        # Fan-out to WS clients first — never block live UI on SQLite handlers.
        async with self._lock:
            subscribers = list(self._subscribers)
        for queue in subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                try:
                    _ = queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    pass

        for handler in list(self._handlers):
            try:
                asyncio.create_task(self._run_handler(handler, event))
            except Exception:
                pass

    @staticmethod
    async def _run_handler(handler: EventHandler, event: dict[str, Any]) -> None:
        try:
            await handler(event)
        except Exception:
            # Handlers must not break broadcast
            pass

    @staticmethod
    def dumps(event: dict[str, Any]) -> str:
        return json.dumps(event, ensure_ascii=False)


_event_hub: EventHub | None = None


def get_event_hub() -> EventHub:
    global _event_hub
    if _event_hub is None:
        _event_hub = EventHub()
    return _event_hub
