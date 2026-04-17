# HeadCounter Server - Docker Deployment

## Quick Start

### 1. Build the image
```bash
docker build -t headcounter-server:latest .
```

### 2. Tag for Docker Hub
Replace `YOUR_DOCKER_HUB_USERNAME` with your actual Docker Hub username:
```bash
docker tag headcounter-server:latest YOUR_DOCKER_HUB_USERNAME/headcounter-server:latest
```

### 3. Push to Docker Hub
```bash
docker push YOUR_DOCKER_HUB_USERNAME/headcounter-server:latest
```

---

## Running the Container

### Basic run (ephemeral storage)
```bash
docker run -p 3456:3456 headcounter-server:latest
```

### With persistent data storage
```bash
docker run -p 3456:3456 -v headcounter-data:/app/data headcounter-server:latest
```

### With custom port
```bash
docker run -p 8080:3456 -v headcounter-data:/app/data headcounter-server:latest
```

### Using Docker Compose

1. Copy `.env.example` to `.env` and update your Docker Hub username:
```bash
cp .env.example .env
```

2. Update `DOCKER_HUB_USERNAME` in `.env` with your actual username.

3. Pull and run:
```bash
docker-compose up -d
```

### Using Docker Compose (Local Build)

If you want to build first then run with compose:
```bash
docker-compose -f docker-compose.yml -f docker-compose.build.yml up -d
```

Or simply:
```bash
docker build -t ${DOCKER_HUB_USERNAME:-your_username}/headcounter-server:latest .
docker-compose up -d
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCKER_HUB_USERNAME` | `your_username` | Your Docker Hub username (required for push) |
| `VERSION` | `latest` | Image version tag |
| `PORT` | `3456` | Host port to expose |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCKER_HUB_USERNAME` | `your_username` | Your Docker Hub username (required for push) |
| `VERSION` | `latest` | Image version tag |
| `PORT` | `3456` | Host port to expose |
| `NODE_ENV` | `production` | Node environment |

---

## API Endpoints

Once running, access the API at `http://localhost:3456`:

- `GET /` - Dashboard web UI
- `GET /api/status` - Server status
- `GET /api/nodes` - List registered nodes
- `GET /api/counts` - Get count reports
- `POST /api/node/register` - Register a new node
- `POST /api/heartbeat` - Send heartbeat (auth required)
- `POST /api/count` - Report count (auth required)
- `DELETE /api/nodes/:id` - Revoke a node

---

## Health Check

The container includes a health check that verifies the `/api/status` endpoint every 30 seconds.

---

## Data Persistence

The SQLite database is stored at `/app/data/storage.db`. Mount a volume at `/app/data` to persist data across container restarts.
