FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libusb-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN mkdir -p /app/data

ENV CMS_USB_MOCK_MODE=true \
    CMS_DATABASE_URL=sqlite+aiosqlite:////app/data/cms.db \
    CMS_HWID_CACHE_PATH=/app/data/hwid.cache \
    CMS_PUBLIC_KEY_PATH=/keys/public_key.pem \
    CMS_CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
