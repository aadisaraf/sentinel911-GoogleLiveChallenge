FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for pycryptodome
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.prod.txt requirements.txt ./
RUN pip install --no-cache-dir -r requirements.prod.txt

COPY . .

# Cloud Run uses PORT env var (default 8080)
ENV PORT=8080

EXPOSE ${PORT}

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
