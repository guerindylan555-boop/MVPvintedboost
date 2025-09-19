# Python backend Dockerfile
FROM python:3.12-slim

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY backend ./backend
COPY vinted ./vinted

# Ensure both packages are importable
ENV PYTHONPATH=/app

ENV PORT=8000
EXPOSE 8000

# Env placeholders (override in Dokploy)
ENV GOOGLE_API_KEY=""
ENV GENAI_MODEL="gemini-2.5-flash-image-preview"
ENV CORS_ALLOW_ORIGINS="*"

# Run the app
# Allow overriding worker count via env
ENV UVICORN_WORKERS=2
CMD ["/bin/sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers ${UVICORN_WORKERS:-2}"]
