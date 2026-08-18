# Jablotron Enterprise CMS

Offline-capable alarm CMS with direct USB multi-panel control and RSA license gating.

## Structure

- `admin_tool_keygen.py` — Admin tool: generate RSA keys + sign `.req` → `.lic`
- `backend/` — FastAPI app (`iot_core` + `license_manager`)
- `keys/public_key.pem` — Public key shipped with the app (generate via keygen)

## Quick start

```bash
# 1) Create venv & install
cd backend
python -m venv .venv
.\.venv\Scripts\activate          # Windows
pip install -r requirements.txt

# 2) Generate keys (Admin machine) — from repo root
cd ..
python admin_tool_keygen.py gen-keys --out-dir keys

# 3) Run API
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open docs: http://127.0.0.1:8000/docs

## Offline license flow

1. UI/API: `GET /api/license/export-req` → download `.req`
2. Admin: `python admin_tool_keygen.py sign --req file.req --out file.lic --days 365`
3. UI/API: `POST /api/license/import-lic` (multipart file)
4. Without valid license, control APIs (`POST /api/panels/group-action`) return **403** (read-only)

## Main endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/health` | Health + license mode |
| GET | `/api/license/status` | License status |
| GET | `/api/license/export-req` | Download `.req` |
| POST | `/api/license/import-lic` | Upload `.lic` |
| GET | `/api/panels` | List panels |
| PATCH | `/api/panels/{id}` | Rename panel (license) |
| GET | `/api/panels/{id}/devices` | Devices on panel |
| POST | `/api/panels/group-action` | Arm/Disarm (license) |
| GET | `/api/devices` | All devices (+ filter) |
| POST | `/api/devices` | Declare device (license) |
| PATCH | `/api/devices/{global_id}` | Update / place on map |
| DELETE | `/api/devices/{global_id}` | Delete device |
| GET/POST | `/api/maps` | List / create floor maps |
| PATCH/DELETE | `/api/maps/{id}` | Update / delete map |
| GET | `/api/events` | Audit trail history |
| WS | `/ws/events` | Real-time events |

## UI pages

| Route | Chức năng |
|-------|-----------|
| `/` | Điều khiển tủ + bản đồ realtime + live events |
| `/devices` | Khai báo thiết bị (thêm / sửa / xóa) |
| `/status` | Trạng thái theo danh sách (filter realtime) |
| `/maps` | Bản đồ mặt bằng — CRUD map + đặt/kéo thiết bị |
| `/history` | Lịch sử / audit trail |
| `/settings` | Bản quyền offline |

Default USB mode is **real HID** (`CMS_USB_MOCK_MODE=false`, VID `16D6` / PID `0008`).

For **demo without hardware**, set `CMS_USB_MOCK_MODE=true` in `.env` or `docker-compose.yml`.

### USB thật — Linux & Windows (Docker UI)

Docker **không** passthrough USB HID ổn định (đặc biệt Windows / Docker Desktop). Kiến trúc dùng chung cả hai nền tảng:

- **Backend native trên host** (`:8010`) — truy cập HID qua `hidapi`
- **UI trong Docker** (`:8080`) — nginx proxy tới backend host

```bash
# Linux
sudo bash scripts/setup-deps-linux.sh   # lần đầu
sudo bash scripts/setup-usb-linux.sh    # udev
./scripts/deploy-usb-linux.sh

# Windows (PowerShell, Docker Desktop đang chạy)
.\scripts\deploy-usb-windows.ps1
```

| | Linux | Windows |
|--|-------|---------|
| Deploy | `./scripts/deploy-usb-linux.sh` | `.\scripts\deploy-usb-windows.ps1` |
| Check | `./scripts/check-usb-linux.sh` | `.\scripts\check-usb-windows.ps1` |
| Stop | `./scripts/stop-cms.sh` | `.\scripts\stop-cms.ps1` |
| UI compose | `docker-compose.usb-host.linux.yml` | `docker-compose.usb-host.yml` |

- **UI:** http://127.0.0.1:8080  
- **API:** http://127.0.0.1:8010/api/usb/status  

Cắm USB Link Jablotron → tủ `connection: usb`, trạng thái cảm biến từ giao thức HID.

## Frontend (local Vite)

```bash
cd frontend
npm install
npm run dev
```

UI: http://127.0.0.1:5173 — Vite proxies `/api` and `/ws` to backend `:8000`.

## Docker (UI + Backend, mock / không USB)

Yêu cầu: đã có `keys/public_key.pem` (chạy `python admin_tool_keygen.py gen-keys`).

```bash
docker compose up --build
```

- **UI:** http://127.0.0.1:8080 (nginx phục vụ React + proxy API/WS)
- Backend chỉ expose nội bộ trong network Docker (`backend:8000`)
- Dùng cho demo / không cần HID thật (`CMS_USB_MOCK_MODE`)

Tắt stack: `docker compose down` (hoặc `.\scripts\stop-cms.ps1` / `./scripts/stop-cms.sh`)
