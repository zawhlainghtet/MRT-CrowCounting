import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';
import { StorageDatabase } from '../storage/database';

const DEFAULT_PORT = 3456;

export class Server {
    private app: Express;
    private port: number;
    private database: StorageDatabase | null = null;
    private server: any = null;

    constructor(port: number = DEFAULT_PORT) {
        this.app = express();
        this.port = port;
        this.setupMiddleware();
        this.setupRoutes();
    }

    private setupMiddleware(): void {
        this.app.use(cors());
        this.app.use(express.json());
    }

    private setupRoutes(): void {
        this.app.get('/', (req: Request, res: Response) => {
            const dashboardPath = path.join(__dirname, 'dashboard.html');
            if (fs.existsSync(dashboardPath)) {
                res.sendFile(dashboardPath);
            } else {
                res.send(`
                    <html>
                        <head><title>HeadCounter Server</title></head>
                        <body>
                            <h1>HeadCounter Server</h1>
                            <p>Server is running</p>
                            <ul>
                                <li><a href="/api/nodes">/api/nodes</a> - List nodes</li>
                                <li><a href="/api/counts">/api/counts</a> - Get counts</li>
                            </ul>
                        </body>
                    </html>
                `);
            }
        });

        this.app.post('/api/node/register', (req: Request, res: Response) => {
            const { name } = req.body;
            if (!name) {
                return res.status(400).json({ error: 'Name is required' });
            }

            const nodeId = this.generateId();
            const token = this.generateToken();

            this.database?.registerNode(nodeId, name, token);

            res.json({ nodeId, token });
        });

        this.app.post('/api/heartbeat', (req: Request, res: Response) => {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Missing or invalid authorization' });
            }

            const token = authHeader.substring(7);
            const node = this.database?.getNodeByToken(token);

            if (!node) {
                return res.status(401).json({ error: 'Invalid token' });
            }

            this.database?.updateNodeHeartbeat(node.id);

            res.json({ ok: true });
        });

        this.app.post('/api/count', (req: Request, res: Response) => {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'Missing or invalid authorization' });
            }

            const token = authHeader.substring(7);
            const node = this.database?.getNodeByToken(token);

            if (!node) {
                return res.status(401).json({ error: 'Invalid token' });
            }

            const { count, capturedAt } = req.body;
            if (typeof count !== 'number') {
                return res.status(400).json({ error: 'Count is required and must be a number' });
            }

            const capturedDate = capturedAt ? new Date(capturedAt) : new Date();
            this.database?.saveCountReport(node.id, count, capturedDate);

            res.json({ ok: true });
        });

        this.app.delete('/api/nodes/:id', (req: Request, res: Response) => {
            const nodeId = req.params.id;
            if (!nodeId) {
                return res.status(400).json({ error: 'Node ID is required' });
            }

            const node = this.database?.getNode(nodeId);
            if (!node) {
                return res.status(404).json({ error: 'Node not found' });
            }

            this.database?.revokeNode(nodeId);
            res.json({ ok: true, message: `Node ${nodeId} revoked` });
        });

        this.app.get('/api/nodes', (req: Request, res: Response) => {
            const nodes = this.database?.getAllNodes() || [];
            const latestCounts = this.database?.getLatestCountPerNode() || [];
            
            const latestCountsMap = new Map(latestCounts.map(c => [c.nodeId, c]));

            const response = nodes.map(node => ({
                id: node.id,
                name: node.name,
                status: node.status,
                lastSeen: node.lastSeen,
                createdAt: node.createdAt,
                lastCount: latestCountsMap.get(node.id)?.count ?? null,
                lastCountAt: latestCountsMap.get(node.id)?.capturedAt ?? null
            }));

            res.json(response);
        });

        this.app.get('/api/counts', (req: Request, res: Response) => {
            const limit = parseInt(req.query.limit as string) || 100;
            const reports = this.database?.getCountReports(limit) || [];
            
            const nodes = this.database?.getAllNodes() || [];
            const nodeMap = new Map(nodes.map(n => [n.id, n.name]));

            const response = reports.map(report => ({
                nodeId: report.nodeId,
                nodeName: nodeMap.get(report.nodeId) || 'Unknown',
                count: report.count,
                capturedAt: report.capturedAt,
                reportedAt: report.reportedAt
            }));

            res.json(response);
        });

        this.app.get('/api/status', (req: Request, res: Response) => {
            const nodes = this.database?.getAllNodes() || [];
            const onlineCount = nodes.filter(n => n.status === 'online').length;
            const offlineCount = nodes.filter(n => n.status === 'offline').length;

            res.json({
                running: this.server !== null,
                port: this.port,
                nodeCount: nodes.length,
                onlineCount,
                offlineCount
            });
        });

        this.app.get('/display', (req: Request, res: Response) => {
            const displayPath = path.join(__dirname, 'display.html');
            if (fs.existsSync(displayPath)) {
                res.sendFile(displayPath);
            } else {
                res.status(404).send('Display page not found');
            }
        });
    }

    private generateId(): string {
        return 'node_' + Math.random().toString(36).substring(2, 15);
    }

    private generateToken(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let token = '';
        for (let i = 0; i < 32; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    }

    async start(storageDir: string): Promise<void> {
        this.database = new StorageDatabase(storageDir);
        await this.database.initialize();

        return new Promise((resolve) => {
            this.server = this.app.listen(this.port, () => {
                console.log(`HeadCounter Server running on port ${this.port}`);
                resolve();
            });
        });
    }

    stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.database?.close();
                    this.server = null;
                    console.log('Server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    isRunning(): boolean {
        return this.server !== null;
    }
}
