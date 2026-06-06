# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build
# Output lands in /frontend/../static == /static

# ── Stage 1b: Build Mobile React frontend ─────────────────────────────────────
FROM node:20-alpine AS mobile-frontend-builder
WORKDIR /mobile-frontend

COPY mobile-frontend/package*.json ./
RUN npm install

COPY mobile-frontend/ ./
RUN npm run build
# Output lands in /mobile-frontend/../static_mobile == /static_mobile


# ── Stage 2: Python dependency builder ────────────────────────────────────────
FROM python:3.12-slim AS python-builder
WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 3: Runtime image ────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime
WORKDIR /app

ARG GIT_COMMIT=unknown
ARG BUILD_DATE=unknown
ARG BUILD_NUMBER=0
ENV GIT_COMMIT=$GIT_COMMIT
ENV BUILD_DATE=$BUILD_DATE
ENV BUILD_NUMBER=$BUILD_NUMBER

# Runtime system deps only
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 curl postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages from builder
COPY --from=python-builder /install /usr/local

# Copy application source
COPY . .

# Copy compiled frontend assets into static/
COPY --from=frontend-builder /static ./static
COPY --from=mobile-frontend-builder /static_mobile ./static_mobile

# Pre-create directory for persistent volume mounts to ensure correct appuser ownership
RUN mkdir -p static/uploads/leagues backups

# Non-root user for security
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser


EXPOSE 8080

CMD ["sh", "-c", "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8080 --workers 4"]
