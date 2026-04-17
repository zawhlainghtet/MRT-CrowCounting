# HeadCounter Server API Specification

## Overview

The HeadCounter Server is a REST API server that aggregates head count reports from multiple camera nodes. It provides node registration, heartbeat monitoring, and count reporting endpoints.

**Base URL:** `http://<host>:3456`

**Default Port:** `3456`

---

## Authentication

### Bearer Token Authentication

Protected endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <token>
```

Tokens are generated during node registration and must be stored securely on nodes.

---

## Endpoints

### 1. Register Node

Register a new camera node and receive an authentication token.

**Endpoint:** `POST /api/node/register`

**Authentication:** None required

**Request Body:**
```json
{
  "name": "string"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable name for the node |

**Response (200 OK):**
```json
{
  "nodeId": "node_abc123xyz",
  "token": "Drj5yfguXNH8lr9K4a7MjM8vBslyHJh4"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `nodeId` | string | Unique identifier for the node (prefix: `node_`) |
| `token` | string | 32-character authentication token |

**Error Response (400 Bad Request):**
```json
{
  "error": "Name is required"
}
```

**Example Request:**
```bash
curl -X POST http://localhost:3456/api/node/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Office-Entry-Camera"}'
```

**Example Response:**
```json
{
  "nodeId": "node_k5qjvd6zehp",
  "token": "Drj5yfguXNH8lr9K4a7MjM8vBslyHJh4"
}
```

---

### 2. Heartbeat

Node sends a heartbeat to indicate liveness. Updates the node's `lastSeen` timestamp and sets status to `online`.

**Endpoint:** `POST /api/heartbeat`

**Authentication:** Bearer token required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Request Body:** None required

**Response (200 OK):**
```json
{
  "ok": true
}
```

**Error Response (401 Unauthorized):**
```json
{
  "error": "Missing or invalid authorization"
}
```

```json
{
  "error": "Invalid token"
}
```

**Example Request:**
```bash
curl -X POST http://localhost:3456/api/heartbeat \
  -H "Authorization: Bearer Drj5yfguXNH8lr9K4a7MjM8vBslyHJh4"
```

---

### 3. Report Count

Node reports a head count result after processing an image.

**Endpoint:** `POST /api/count`

**Authentication:** Bearer token required

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "count": 5,
  "capturedAt": "2026-03-18T10:30:00Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `count` | number | Yes | Number of heads detected (integer) |
| `capturedAt` | string (ISO 8601) | No | Timestamp when image was captured. Defaults to server time if omitted |

**Response (200 OK):**
```json
{
  "ok": true
}
```

**Error Response (400 Bad Request):**
```json
{
  "error": "Count is required and must be a number"
}
```

**Error Response (401 Unauthorized):**
```json
{
  "error": "Invalid token"
}
```

**Example Request:**
```bash
curl -X POST http://localhost:3456/api/count \
  -H "Authorization: Bearer Drj5yfguXNH8lr9K4a7MjM8vBslyHJh4" \
  -H "Content-Type: application/json" \
  -d '{"count": 5, "capturedAt": "2026-03-18T10:30:00Z"}'
```

---

### 4. List Nodes

Retrieve all registered nodes with their status and latest count.

**Endpoint:** `GET /api/nodes`

**Authentication:** None required

**Response (200 OK):**
```json
[
  {
    "id": "node_k5qjvd6zehp",
    "name": "Office-Entry-Camera",
    "status": "online",
    "lastSeen": "2026-03-18T10:35:00Z",
    "createdAt": "2026-03-18T07:00:00Z",
    "lastCount": 5,
    "lastCountAt": "2026-03-18T10:30:00Z"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique node identifier |
| `name` | string | Human-readable name |
| `status` | string | `"online"` or `"offline"` |
| `lastSeen` | string (ISO 8601) | Last heartbeat timestamp |
| `createdAt` | string (ISO 8601) | Registration timestamp |
| `lastCount` | number \| null | Most recent head count |
| `lastCountAt` | string (ISO 8601) \| null | When last count was captured |

**Example Request:**
```bash
curl http://localhost:3456/api/nodes
```

---

### 5. Get Count Reports

Retrieve historical count reports from all nodes.

**Endpoint:** `GET /api/counts`

**Authentication:** None required

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 100 | Maximum number of reports to return |

**Response (200 OK):**
```json
[
  {
    "nodeId": "node_k5qjvd6zehp",
    "nodeName": "Office-Entry-Camera",
    "count": 5,
    "capturedAt": "2026-03-18T10:30:00Z",
    "reportedAt": "2026-03-18T10:30:05Z"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `nodeId` | string | Node identifier |
| `nodeName` | string | Node name |
| `count` | number | Head count value |
| `capturedAt` | string (ISO 8601) | When image was captured |
| `reportedAt` | string (ISO 8601) | When report was received by server |

**Example Request:**
```bash
curl "http://localhost:3456/api/counts?limit=50"
```

---

### 6. Server Status

Get server operational status and aggregate statistics.

**Endpoint:** `GET /api/status`

**Authentication:** None required

**Response (200 OK):**
```json
{
  "running": true,
  "port": 3456,
  "nodeCount": 3,
  "onlineCount": 2,
  "offlineCount": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `running` | boolean | Whether server is active |
| `port` | number | Server port |
| `nodeCount` | number | Total registered nodes |
| `onlineCount` | number | Nodes with heartbeat in last interval |
| `offlineCount` | number | Nodes without recent heartbeat |

**Example Request:**
```bash
curl http://localhost:3456/api/status
```

---

### 7. Dashboard (Web UI)

Serves the HTML dashboard for viewing counts and node status.

**Endpoint:** `GET /`

**Authentication:** None required

**Response:** HTML page

**Example:**
```bash
open http://localhost:3456
```

---

## Error Codes

| HTTP Status | Error Message | Description |
|-------------|---------------|-------------|
| 400 | `Name is required` | Registration missing node name |
| 400 | `Count is required and must be a number` | Invalid count in POST /api/count |
| 401 | `Missing or invalid authorization` | Missing Bearer header |
| 401 | `Invalid token` | Token not found in database |
| 500 | Internal server error | Server-side error |

---

## Data Models

### Node

```typescript
interface Node {
  id: string;           // e.g., "node_k5qjvd6zehp"
  name: string;          // e.g., "Office-Entry-Camera"
  token: string;         // 32-char authentication token
  createdAt: Date;       // Registration timestamp
  lastSeen: Date | null; // Last heartbeat timestamp
  status: "online" | "offline";
}
```

### CountReport

```typescript
interface CountReport {
  id: number;
  nodeId: string;
  count: number;
  capturedAt: Date;
  reportedAt: Date;
}
```

### ServerStatus

```typescript
interface ServerStatus {
  running: boolean;
  port: number;
  nodeCount: number;
  onlineCount: number;
  offlineCount: number;
}
```

---

## Database Schema

### Table: `nodes`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `name` | TEXT | NOT NULL |
| `token` | TEXT | NOT NULL |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |
| `last_seen` | DATETIME | |
| `status` | TEXT | DEFAULT 'offline' |

### Table: `count_reports`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `node_id` | TEXT | FOREIGN KEY REFERENCES nodes(id) |
| `count` | INTEGER | NOT NULL |
| `captured_at` | DATETIME | NOT NULL |
| `reported_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP |

---

## Usage Example: Complete Workflow

### Step 1: Start Server
```bash
node dist/main.js server start
```

### Step 2: Register a Node
```bash
curl -X POST http://localhost:3456/api/node/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Front-Door-Camera"}'
```

Response:
```json
{
  "nodeId": "node_abc123",
  "token": "Xk9Pm2L8vN4qR7jT6wY3zA1bC5dE8fG0"
}
```

### Step 3: Configure Node
Add to node's config.json:
```json
{
  "server": {
    "url": "http://server-ip:3456",
    "token": "Xk9Pm2L8vN4qR7jT6wY3zA1bC5dE8fG0",
    "heartbeatIntervalSeconds": 30
  }
}
```

### Step 4: Send Heartbeat (from node)
```bash
curl -X POST http://localhost:3456/api/heartbeat \
  -H "Authorization: Bearer Xk9Pm2L8vN4qR7jT6wY3zA1bC5dE8fG0"
```

### Step 5: Report Count (from node after ML inference)
```bash
curl -X POST http://localhost:3456/api/count \
  -H "Authorization: Bearer Xk9Pm2L8vN4qR7jT6wY3zA1bC5dE8fG0" \
  -H "Content-Type: application/json" \
  -d '{"count": 12, "capturedAt": "2026-03-18T10:30:00Z"}'
```

### Step 6: View Dashboard
```
http://localhost:3456
```

---

## CLI Commands Reference

```bash
# Server management
head-counter server start    # Start the API server on port 3456
head-counter server stop     # Stop the server
head-counter server status   # Show server status

# Node management
head-counter node register [name]  # Register new node
head-counter node list             # List all nodes
head-counter node revoke <id>      # Revoke a node's access
```

---

## Testing Checklist for AI Agents

- [ ] Test `POST /api/node/register` with valid name
- [ ] Test `POST /api/node/register` with missing name (expect 400)
- [ ] Test `POST /api/heartbeat` with valid token
- [ ] Test `POST /api/heartbeat` with invalid token (expect 401)
- [ ] Test `POST /api/heartbeat` without auth header (expect 401)
- [ ] Test `POST /api/count` with valid token and count
- [ ] Test `POST /api/count` with missing count (expect 400)
- [ ] Test `POST /api/count` with non-numeric count (expect 400)
- [ ] Test `GET /api/nodes` returns array
- [ ] Test `GET /api/nodes` includes all registered nodes
- [ ] Test `GET /api/counts` returns array
- [ ] Test `GET /api/counts?limit=5` respects limit
- [ ] Test `GET /api/status` returns running=true when server is up
- [ ] Test `GET /` returns HTML dashboard
- [ ] Verify node status changes to "offline" after heartbeat interval expires
