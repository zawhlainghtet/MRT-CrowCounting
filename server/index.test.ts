import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import * as path from 'path';
import * as fs from 'fs';
import { Server } from './index';

const TEST_DIR = path.join(__dirname, '../../test-temp-' + Date.now());

describe('HeadCounter Server API', () => {
    let server: Server;
    let testPort: number;
    let baseUrl: string;
    let registeredNodeToken: string;
    let registeredNodeId: string;

    beforeAll(async () => {
        testPort = 34561;
        baseUrl = `http://localhost:${testPort}`;
        server = new Server(testPort);
        await server.start(TEST_DIR);
    });

    afterAll(async () => {
        await server.stop();
        if (fs.existsSync(TEST_DIR)) {
            fs.rmSync(TEST_DIR, { recursive: true, force: true });
        }
    });

    beforeEach(() => {
        registeredNodeToken = '';
        registeredNodeId = '';
    });

    describe('POST /api/node/register', () => {
        it('registers a node with valid name and returns nodeId and token', async () => {
            const response = await request(baseUrl)
                .post('/api/node/register')
                .send({ name: 'Test-Camera-Node' })
                .expect(200);

            expect(response.body.nodeId).toMatch(/^node_/);
            expect(response.body.token).toHaveLength(32);
            registeredNodeToken = response.body.token;
            registeredNodeId = response.body.nodeId;
        });

        it('returns 400 when name is missing', async () => {
            const response = await request(baseUrl)
                .post('/api/node/register')
                .send({})
                .expect(400);

            expect(response.body.error).toBe('Name is required');
        });
    });

    describe('POST /api/heartbeat', () => {
        beforeEach(async () => {
            const response = await request(baseUrl)
                .post('/api/node/register')
                .send({ name: 'Heartbeat-Test-Node' });
            registeredNodeToken = response.body.token;
            registeredNodeId = response.body.nodeId;
        });

        it('returns ok with valid token', async () => {
            const response = await request(baseUrl)
                .post('/api/heartbeat')
                .set('Authorization', `Bearer ${registeredNodeToken}`)
                .expect(200);

            expect(response.body.ok).toBe(true);
        });

        it('returns 401 with invalid token', async () => {
            const response = await request(baseUrl)
                .post('/api/heartbeat')
                .set('Authorization', 'Bearer invalid_token_12345')
                .expect(401);

            expect(response.body.error).toBe('Invalid token');
        });

        it('returns 401 without auth header', async () => {
            const response = await request(baseUrl)
                .post('/api/heartbeat')
                .expect(401);

            expect(response.body.error).toBe('Missing or invalid authorization');
        });
    });

    describe('POST /api/count', () => {
        beforeEach(async () => {
            const response = await request(baseUrl)
                .post('/api/node/register')
                .send({ name: 'Count-Report-Node' });
            registeredNodeToken = response.body.token;
            registeredNodeId = response.body.nodeId;
        });

        it('reports count with valid token and count', async () => {
            const capturedAt = new Date().toISOString();
            const response = await request(baseUrl)
                .post('/api/count')
                .set('Authorization', `Bearer ${registeredNodeToken}`)
                .send({ count: 5, capturedAt })
                .expect(200);

            expect(response.body.ok).toBe(true);
        });

        it('returns 400 when count is missing', async () => {
            const response = await request(baseUrl)
                .post('/api/count')
                .set('Authorization', `Bearer ${registeredNodeToken}`)
                .send({})
                .expect(400);

            expect(response.body.error).toBe('Count is required and must be a number');
        });

        it('returns 400 when count is non-numeric', async () => {
            const response = await request(baseUrl)
                .post('/api/count')
                .set('Authorization', `Bearer ${registeredNodeToken}`)
                .send({ count: 'not-a-number' })
                .expect(400);

            expect(response.body.error).toBe('Count is required and must be a number');
        });

        it('returns 401 with invalid token', async () => {
            const response = await request(baseUrl)
                .post('/api/count')
                .set('Authorization', 'Bearer invalid_token')
                .send({ count: 5 })
                .expect(401);

            expect(response.body.error).toBe('Invalid token');
        });
    });

    describe('GET /api/nodes', () => {
        beforeEach(async () => {
            const response = await request(baseUrl)
                .post('/api/node/register')
                .send({ name: 'List-Nodes-Node' });
            registeredNodeToken = response.body.token;
        });

        it('returns an array', async () => {
            const response = await request(baseUrl)
                .get('/api/nodes')
                .expect(200);

            expect(Array.isArray(response.body)).toBe(true);
        });

        it('includes all registered nodes', async () => {
            const initialResponse = await request(baseUrl)
                .get('/api/nodes');
            const initialCount = initialResponse.body.length;

            await request(baseUrl)
                .post('/api/node/register')
                .send({ name: 'Another-Test-Node' });

            const response = await request(baseUrl)
                .get('/api/nodes');

            expect(response.body.length).toBe(initialCount + 1);
        });
    });

    describe('GET /api/counts', () => {
        beforeEach(async () => {
            const response = await request(baseUrl)
                .post('/api/node/register')
                .send({ name: 'Counts-List-Node' });
            registeredNodeToken = response.body.token;

            await request(baseUrl)
                .post('/api/count')
                .set('Authorization', `Bearer ${registeredNodeToken}`)
                .send({ count: 3 });
        });

        it('returns an array', async () => {
            const response = await request(baseUrl)
                .get('/api/counts')
                .expect(200);

            expect(Array.isArray(response.body)).toBe(true);
        });

        it('respects limit parameter', async () => {
            await request(baseUrl)
                .post('/api/node/register')
                .send({ name: 'More-Counts-Node-1' });
            await request(baseUrl)
                .post('/api/node/register')
                .send({ name: 'More-Counts-Node-2' });

            const response = await request(baseUrl)
                .get('/api/counts?limit=1')
                .expect(200);

            expect(response.body.length).toBeLessThanOrEqual(1);
        });
    });

    describe('GET /api/status', () => {
        it('returns running=true when server is up', async () => {
            const response = await request(baseUrl)
                .get('/api/status')
                .expect(200);

            expect(response.body.running).toBe(true);
            expect(response.body.port).toBe(testPort);
            expect(typeof response.body.nodeCount).toBe('number');
            expect(typeof response.body.onlineCount).toBe('number');
            expect(typeof response.body.offlineCount).toBe('number');
        });
    });

    describe('GET /', () => {
        it('returns HTML dashboard', async () => {
            const response = await request(baseUrl)
                .get('/')
                .expect(200);

            expect(response.headers['content-type']).toMatch(/html/);
        });
    });

    describe('Node status offline transition', () => {
        it('sets node status to online after heartbeat', async () => {
            const registerResponse = await request(baseUrl)
                .post('/api/node/register')
                .send({ name: 'Offline-Test-Node' });
            const token = registerResponse.body.token;

            const nodeResponseBefore = await request(baseUrl)
                .get('/api/nodes');
            const nodeBefore = nodeResponseBefore.body.find(
                (n: any) => n.id === registerResponse.body.nodeId
            );

            await request(baseUrl)
                .post('/api/heartbeat')
                .set('Authorization', `Bearer ${token}`);

            const nodeResponseAfter = await request(baseUrl)
                .get('/api/nodes');
            const nodeAfter = nodeResponseAfter.body.find(
                (n: any) => n.id === registerResponse.body.nodeId
            );

            expect(nodeBefore.status).toBe('offline');
            expect(nodeAfter.status).toBe('online');
        });
    });
});
