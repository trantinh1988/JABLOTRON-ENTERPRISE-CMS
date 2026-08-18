import asyncio, json, time
try:
    import websockets
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets", "-q"])
    import websockets

async def main():
    types = {}
    async with websockets.connect("ws://127.0.0.1:8010/ws/events") as ws:
        t0 = time.time()
        while time.time() - t0 < 5:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=1)
            except asyncio.TimeoutError:
                continue
            data = json.loads(msg)
            t = data.get("type")
            types[t] = types.get(t, 0) + 1
            if t in ("panel_live", "device_state", "devices_state_batch", "devices_state_snapshot"):
                print(json.dumps({k: data.get(k) for k in ("type","panel_id","receiving","packet_count","device_updates","state","device_id") if k in data or True}, ensure_ascii=False)[:240])
    print("SUMMARY", types)

asyncio.run(main())
