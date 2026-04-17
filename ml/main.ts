#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { Config, loadConfig, saveConfig } from './config/loader';
import { CameraSource, ImageCaptureResult } from './camera';
import { UsbCamera } from './camera/usb';
import { RtspCamera } from './camera/rtsp';
import { StorageDatabase } from './storage/database';
import { MlRunner, MlZoneResult } from './ml/runner';
import { ThrottleRunner } from './ml/throttle';
import { DaemonManager } from './daemon/manager';
import { ConfigServer } from './ui/server';
import { Server } from './server/index';
import { ServerClient } from './server/client';

const DEFAULT_CONFIG_PATH = '/usr/local/headcounter/config/config.json';

function getBinaryDir(): string {
    const pkgExecPath = process.env.PKG_EXECPATH;
    if (pkgExecPath) {
        return path.dirname(pkgExecPath);
    }
    return path.dirname(process.execPath);
}

/**
 * Check if we're running from a pkg'd (packaged) binary.
 * Native modules like serialport don't work reliably in pkg'd packages.
 */
function isPackaged(): boolean {
    return !!process.env.PKG_EXECPATH;
}

function resolveAppPath(relativePath: string): string {
    // If the path is already absolute, return it as-is
    if (path.isAbsolute(relativePath)) {
        return relativePath;
    }
    // Resolve relative paths against the binary directory, not cwd
    return path.join(getBinaryDir(), relativePath);
}

function findConfigPath(): string {
    const binaryDir = getBinaryDir();
    
    const productionConfig = DEFAULT_CONFIG_PATH;
    if (fs.existsSync(productionConfig)) {
        return productionConfig;
    }
    
    const devConfigInBinary = path.join(binaryDir, '..', 'resources', 'dev-config.json');
    if (fs.existsSync(devConfigInBinary)) {
        return devConfigInBinary;
    }
    
    const devConfigInCwd = path.join(process.cwd(), 'resources', 'dev-config.json');
    if (fs.existsSync(devConfigInCwd) && fs.existsSync(path.join(process.cwd(), 'dist', 'main.js'))) {
        return devConfigInCwd;
    }
    
    return productionConfig;
}

interface CaptureRecord {
    imagePath: string;
    capturedAt: Date;
    headCount: number;
    processingTimeMs: number;
}

class HeadCounterApp {
    private config!: Config;
    private camera: CameraSource | null = null;
    private database: StorageDatabase | null = null;
    private mlRunner: MlRunner | null = null;
    private throttleRunner: ThrottleRunner | null = null;
    private daemonManager: DaemonManager;
    private isRunning: boolean = false;
    private logStream: fs.WriteStream | null = null;
    private configPath: string;
    private initialized: boolean = false;
    private serverClient: ServerClient | null = null;
    private serverInstance: Server | null = null;
    private serialTrigger: any = null;
    private captureQueue: string[] = [];
    private isProcessingQueue: boolean = false;
    private readonly MAX_QUEUE_SIZE: number = 4;

    constructor(configPath: string | null = null) {
        this.daemonManager = new DaemonManager();
        this.configPath = configPath || findConfigPath();
    }

    async initialize(): Promise<void> {
        console.log('Config path:', this.configPath);
        console.log('Binary dir:', getBinaryDir());
        
        try {
            this.config = loadConfig(this.configPath);
        } catch (error) {
            console.log('Loading dev config as fallback');
            this.config = {
                mode: 'dev',
                camera: { type: 'usb', usb: { device: '0', resolution: '1280x720' }, rtsp: { url: '' } },
                capture: { imageFormat: 'jpeg' },
                storage: { directory: 'captured_images', maxTotalSizeMB: 1000, cleanupEnabled: true },
                ml: { command: 'bin/dummy-cli', timeoutSeconds: 30 },
                logging: { level: 'info', path: 'logs' }
            };
        }

        await this.initServices();
        
        if (this.config.logging?.path) {
            const logPath = resolveAppPath(this.config.logging.path);
            if (!fs.existsSync(logPath)) {
                fs.mkdirSync(logPath, { recursive: true });
            }
            this.logStream = fs.createWriteStream(path.join(logPath, 'app.log'), { flags: 'a' });
        }
        
        this.log(`HeadCounter application initialized`);
        this.log(`Mode: ${this.config.mode}`);
        this.log(`Camera type: ${this.config.camera.type}`);
        this.initialized = true;
    }

    private isDevMode(): boolean {
        return this.config.mode === 'dev';
    }

    private async initServices(): Promise<void> {
        if (!this.config.storage?.directory) {
            console.warn('Storage directory not configured');
            return;
        }
        
        const storageDir = resolveAppPath(this.config.storage.directory);
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        
        this.database = new StorageDatabase(storageDir);
        await this.database.initialize();
        
        this.camera = this.createCamera();
        this.mlRunner = new MlRunner(this.config.ml.command, this.config.ml.timeoutSeconds, this.config.camera.usb.runAsUser);
        this.throttleRunner = new ThrottleRunner(this.mlRunner);
        this.throttleRunner.setCallbacks({
            onResult: async (mlResult: MlZoneResult, capturedAt: Date) => {
                const headCount = mlResult.headCount;
                this.log(`ML raw output: ${mlResult.rawOutput || '(none)'}`);

                const record: CaptureRecord = {
                    imagePath: '',  // Will be set by the caller
                    capturedAt,
                    headCount,
                    processingTimeMs: mlResult.processingTime
                };

                await this.database?.saveCapture(record);
                this.log('ML result saved to database');

                if (this.serverClient) {
                    await this.serverClient.sendCount(headCount, capturedAt);
                    this.log('Count reported to server');
                }
            },
            onSkipped: (imagePath: string, reason: string) => {
                this.log(`ML skipped for ${imagePath}: ${reason}`);
            }
        });
        
        if (this.config.server && this.config.server.url && this.config.server.token) {
            this.serverClient = new ServerClient(this.config.server);
            const connected = await this.serverClient.testConnection();
            if (connected) {
                console.log(`Connected to server: ${this.config.server.url}`);
                this.serverClient.startHeartbeat(
                    this.config.server.heartbeatIntervalSeconds,
                    async () => {
                        // After heartbeat, we could optionally send latest count
                    }
                );
            } else {
                console.warn(`Failed to connect to server: ${this.config.server.url}`);
            }
        }
    }

    private createCamera(): CameraSource {
        const storageDir = resolveAppPath(this.config.storage.directory);
        if (this.config.camera.type === 'rtsp') {
            return new RtspCamera(this.config.camera.rtsp.url, storageDir);
        }
        return new UsbCamera(this.config.camera.usb.device, this.config.camera.usb.resolution, storageDir, this.config.camera.usb.runAsUser, this.config.camera.usb.framerate);
    }

    private async initSerial(): Promise<void> {
        const serialConfig = this.config.serial;
        if (!serialConfig?.enabled) {
            return;
        }

        // Skip serial initialization in packaged builds - native modules don't work reliably
        if (isPackaged()) {
            this.log('Serial trigger disabled: native modules not supported in packaged build');
            return;
        }

        try {
            // Dynamic import to avoid loading native serialport bindings when not needed
            const { SerialTrigger } = await import('./serial/index');

            this.serialTrigger = new SerialTrigger({
                enabled: true,
                port: serialConfig.port,
                baudRate: serialConfig.baudRate,
                cooldownMs: serialConfig.cooldownMs || 3000
            });

            // Set up trigger handler - clears queue and captures immediately
            this.serialTrigger.onTrigger(() => {
                this.log('Serial trigger activated - clearing queue for immediate capture');
                this.captureQueue = [];  // Clear any pending interval captures
                this.captureNow();         // Immediate capture
            });

            await this.serialTrigger.initialize();
            this.log('Serial trigger initialized');
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            this.log(`Failed to initialize serial trigger: ${errMsg}`);
            // Continue without serial - interval capture still works
        }
    }

    private async captureNow(): Promise<{ headCount: number } | null> {
        if (!this.camera || !this.database || !this.throttleRunner) {
            this.log('Services not initialized');
            return null;
        }

        const startTime = Date.now();

        try {
            this.log('Starting image capture...');
            const result: ImageCaptureResult = await this.camera.capture();

            if (!result.success) {
                this.log(`Capture failed: ${result.error}`);
                return null;
            }

            const imagePath = result.imagePath!;
            const capturedAt = new Date();
            this.log(`Image captured: ${imagePath}`);

            this.log('Running ML inference...');
            const throttleResult = await this.throttleRunner.execute({
                imagePath,
                capturedAt
            });

            if (throttleResult.skipped) {
                this.log('ML inference skipped (busy with previous capture)');
                return null;
            }

            if (!throttleResult.success) {
                this.log(`ML inference failed: ${throttleResult.reason}`);
                return null;
            }

            // ML started successfully, result will come via callback
            // Return early since ML runs async
            return { headCount: throttleResult.result?.headCount ?? 0 };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Capture error: ${errorMessage}`);
            return null;
        }
    }

    private async performCapture(): Promise<{ headCount: number } | null> {
        // If serial trigger is armed and we have queue space, add to queue
        if (this.serialTrigger?.isArmed() && this.captureQueue.length < this.MAX_QUEUE_SIZE) {
            this.captureQueue.push('interval');
            this.log(`Interval capture queued. Queue size: ${this.captureQueue.length}`);
        }

        // Process queue if not busy
        return this.processQueue();
    }

    private async processQueue(): Promise<{ headCount: number } | null> {
        if (this.isProcessingQueue) {
            return null;
        }

        if (this.captureQueue.length === 0) {
            return null;
        }

        this.isProcessingQueue = true;
        this.captureQueue.shift(); // Remove the front of queue

        try {
            const result = await this.captureNow();
            return result;
        } finally {
            this.isProcessingQueue = false;
            // After processing, if there are more items in queue, process them
            if (this.captureQueue.length > 0) {
                // Use setImmediate to avoid blocking
                setImmediate(() => this.processQueue());
            }
        }
    }

    private log(message: string): void {
        if (!this.logStream) return;
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        this.logStream.write(logMessage);
        console.log(logMessage.trim());
    }

    async start(): Promise<void> {
        if (this.isRunning) {
            this.log('Application is already running');
            return;
        }

        this.log('Starting HeadCounter application...');
        this.isRunning = true;

        // Initialize serial trigger first
        await this.initSerial();

        // Serial trigger will initiate captures on button press

        this.log('Application started successfully');
    }

    async stop(): Promise<void> {
        if (!this.isRunning) {
            this.log('Application is not running');
            return;
        }

        this.log('Stopping HeadCounter application...');
        this.isRunning = false;

        if (this.serverClient) {
            this.serverClient.stopHeartbeat();
            this.serverClient = null;
        }

        if (this.serialTrigger) {
            await this.serialTrigger.close();
            this.serialTrigger = null;
        }

        if (this.logStream) {
            this.logStream.end();
            this.logStream = null;
        }

        if (this.database) {
            this.database.close();
        }

        this.log('Application stopped');
    }

    async stopService(): Promise<void> {
        await this.stop();
        const isDevMode = this.isDevMode();
        await this.daemonManager.stop(isDevMode);
        const { execSync } = require('child_process');
        try {
            execSync('pkill -f "headcounter daemon"', { stdio: 'ignore' });
        } catch {}
    }

    async captureOnce(): Promise<object> {
        const result = await this.captureNow();
        if (result) {
            return { success: true, headCount: result.headCount };
        }
        return { success: false, error: 'Capture failed' };
    }

    getStatus(): object {
        const isDevMode = this.isDevMode();
        const daemonRunning = this.daemonManager.isRunning(isDevMode);
        
        if (!this.initialized || !this.database) {
            return {
                running: daemonRunning,
                mode: this.config?.mode || 'unknown',
                cameraType: this.config?.camera?.type || 'unknown',
                configPath: this.configPath,
                message: 'Database not initialized. Run initialize first or check configuration.'
            };
        }
        return {
            running: daemonRunning,
            mode: this.config.mode,
            cameraType: this.config.camera.type,
            storageUsedMB: this.database.getStorageUsed(),
            totalCaptures: this.database.getTotalCaptures()
        };
    }

    getConfig(): object {
        return this.config;
    }

    saveUserConfig(newConfig: Partial<Config>): void {
        // Deep merge to preserve nested properties
        const mergedConfig: Config = {
            ...this.config,
            ...newConfig,
            camera: {
                ...this.config.camera,
                ...(newConfig.camera || {}),
                usb: {
                    ...this.config.camera.usb,
                    ...(newConfig.camera?.usb || {})
                },
                rtsp: {
                    ...this.config.camera.rtsp,
                    ...(newConfig.camera?.rtsp || {})
                }
            },
            capture: {
                ...this.config.capture,
                ...(newConfig.capture || {})
            },
            storage: {
                ...this.config.storage,
                ...(newConfig.storage || {})
            },
            ml: {
                ...this.config.ml,
                ...(newConfig.ml || {})
            },
            logging: {
                ...this.config.logging,
                ...(newConfig.logging || {})
            },
            serial: {
                ...this.config.serial,
                ...(newConfig.serial || {}),
                enabled: newConfig.serial?.enabled ?? this.config.serial?.enabled ?? false,
                port: newConfig.serial?.port ?? this.config.serial?.port ?? '',
                baudRate: newConfig.serial?.baudRate ?? this.config.serial?.baudRate ?? 115200,
                cooldownMs: newConfig.serial?.cooldownMs ?? this.config.serial?.cooldownMs ?? 3000
            }
        };
        saveConfig(DEFAULT_CONFIG_PATH, mergedConfig);
        this.config = mergedConfig;
        this.camera = this.createCamera();
        this.log('Configuration updated and saved');
    }

    async install(): Promise<void> {
        await this.stop();
        const isDevMode = this.config.mode === 'dev';
        console.log(`Installing Launch ${isDevMode ? 'Agent' : 'Daemon'}...`);
        await this.daemonManager.install(isDevMode);
        console.log('Starting service...');
        await this.daemonManager.start(isDevMode);
        console.log(`${isDevMode ? 'Agent' : 'Daemon'} installed and started successfully`);
    }

    async uninstall(): Promise<void> {
        await this.stop();
        const isDevMode = this.config.mode === 'dev';
        console.log(`Uninstalling Launch ${isDevMode ? 'Agent' : 'Daemon'}...`);
        await this.daemonManager.uninstall(isDevMode);
        console.log(`${isDevMode ? 'Agent' : 'Daemon'} uninstalled`);
    }

    async restart(): Promise<void> {
        const isDevMode = this.config.mode === 'dev';
        console.log(`Restarting Launch ${isDevMode ? 'Agent' : 'Daemon'}...`);
        await this.daemonManager.restart(isDevMode);
        console.log(`${isDevMode ? 'Agent' : 'Daemon'} restarted`);
    }
}

let serverInstance: Server | null = null;

async function handleServerCommand(args: string[]): Promise<void> {
    const subCommand = args[0];

    // Show help without initializing anything
    if (!subCommand || !['start', 'stop', 'status'].includes(subCommand)) {
        console.log('Usage: headcounter server <command>');
        console.log('Commands:');
        console.log('  start   Start the server');
        console.log('  stop    Stop the server');
        console.log('  status  Show server status');
        return;
    }

    switch (subCommand) {
        case 'start':
            if (serverInstance && serverInstance.isRunning()) {
                console.log('Server is already running');
                return;
            }
            
            const serverConfig = loadConfig(findConfigPath());
            const storageDir = resolveAppPath(serverConfig.storage.directory);
            
            serverInstance = new Server(3456);
            await serverInstance.start(storageDir);
            
            process.on('SIGTERM', async () => {
                await serverInstance?.stop();
                process.exit(0);
            });
            
            process.on('SIGINT', async () => {
                await serverInstance?.stop();
                process.exit(0);
            });
            
            break;
            
        case 'stop':
            if (serverInstance) {
                await serverInstance.stop();
                serverInstance = null;
                console.log('Server stopped');
            } else {
                console.log('Server is not running');
            }
            break;
            
        case 'status':
            const statusConfig = loadConfig(findConfigPath());
            const statusStorageDir = resolveAppPath(statusConfig.storage.directory);
            const tempDb = new StorageDatabase(statusStorageDir);
            await tempDb.initialize();
            
            const nodes = tempDb.getAllNodes();
            const online = nodes.filter(n => n.status === 'online').length;
            
            console.log(JSON.stringify({
                running: serverInstance?.isRunning() || false,
                port: 3456,
                nodeCount: nodes.length,
                onlineCount: online,
                offlineCount: nodes.length - online
            }, null, 2));
            
            tempDb.close();
            break;
    }
}

const SERVER_BASE_URL = `http://localhost:${3456}`;

async function isServerRunning(): Promise<boolean> {
    try {
        const axios = (await import('axios')).default;
        await axios.get(`${SERVER_BASE_URL}/api/status`, { timeout: 2000 });
        return true;
    } catch {
        return false;
    }
}

async function handleNodeCommandViaApi(subCommand: string, args: string[]): Promise<void> {
    const axios = (await import('axios')).default;

    switch (subCommand) {
        case 'register': {
            const name = args[1] || `Node-${Date.now()}`;
            const response = await axios.post(`${SERVER_BASE_URL}/api/node/register`, { name });
            const { nodeId, token } = response.data;

            console.log(JSON.stringify({
                nodeId,
                token,
                name,
                message: 'Token generated. Add to node config:',
                config: {
                    server: {
                        url: 'http://<server-ip>:3456',
                        token: token,
                        heartbeatIntervalSeconds: 30
                    }
                }
            }, null, 2));
            break;
        }

        case 'list': {
            const response = await axios.get(`${SERVER_BASE_URL}/api/nodes`);
            const nodes = response.data;
            console.log(JSON.stringify(nodes.map((n: any) => ({
                id: n.id,
                name: n.name,
                status: n.status,
                lastSeen: n.lastSeen,
                createdAt: n.createdAt
            })), null, 2));
            break;
        }

        case 'revoke': {
            const nodeIdToRevoke = args[1];
            if (!nodeIdToRevoke) {
                console.log('Usage: headcounter node revoke <node-id>');
                process.exit(1);
            }
            await axios.delete(`${SERVER_BASE_URL}/api/nodes/${nodeIdToRevoke}`);
            console.log(JSON.stringify({ success: true, message: `Node ${nodeIdToRevoke} revoked` }));
            break;
        }
    }
}

async function handleNodeCommandViaDb(subCommand: string, args: string[]): Promise<void> {
    const nodeConfig = loadConfig(findConfigPath());
    const storageDir = resolveAppPath(nodeConfig.storage.directory);

    const db = new StorageDatabase(storageDir);
    await db.initialize();

    try {
        switch (subCommand) {
            case 'register': {
                const name = args[1] || `Node-${Date.now()}`;
                const nodeId = 'node_' + Math.random().toString(36).substring(2, 15);
                const token = generateToken();

                db.registerNode(nodeId, name, token);

                console.log(JSON.stringify({
                    nodeId,
                    token,
                    name,
                    message: 'Token generated. Add to node config:',
                    config: {
                        server: {
                            url: 'http://<server-ip>:3456',
                            token: token,
                            heartbeatIntervalSeconds: 30
                        }
                    }
                }, null, 2));
                break;
            }

            case 'list': {
                const nodes = db.getAllNodes();
                console.log(JSON.stringify(nodes.map(n => ({
                    id: n.id,
                    name: n.name,
                    status: n.status,
                    lastSeen: n.lastSeen,
                    createdAt: n.createdAt
                })), null, 2));
                break;
            }

            case 'revoke': {
                const nodeIdToRevoke = args[1];
                if (!nodeIdToRevoke) {
                    console.log('Usage: headcounter node revoke <node-id>');
                    process.exit(1);
                }
                db.revokeNode(nodeIdToRevoke);
                console.log(JSON.stringify({ success: true, message: `Node ${nodeIdToRevoke} revoked` }));
                break;
            }
        }
    } finally {
        db.close();
    }
}

async function handleNodeCommand(args: string[]): Promise<void> {
    const subCommand = args[0];

    if (!subCommand || !['register', 'list', 'revoke'].includes(subCommand)) {
        console.log('Usage: headcounter node <command>');
        console.log('Commands:');
        console.log('  register [name]  Register a new node');
        console.log('  list              List all nodes');
        console.log('  revoke <id>      Revoke a node');
        return;
    }

    const serverRunning = await isServerRunning();

    if (serverRunning) {
        try {
            await handleNodeCommandViaApi(subCommand, args);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`API call failed: ${message}`);
            console.error('Falling back to direct database access...');
            await handleNodeCommandViaDb(subCommand, args);
        }
    } else {
        await handleNodeCommandViaDb(subCommand, args);
    }
}

function generateToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
}

async function handleDaemonCommand(command: string): Promise<void> {
    const config = loadConfig(findConfigPath());
    const isDevMode = config.mode === 'dev';
    const daemonManager = new DaemonManager();

    switch (command) {
        case 'install':
            console.log(`Installing Launch ${isDevMode ? 'Agent' : 'Daemon'}...`);
            await daemonManager.install(isDevMode);
            console.log('Starting service...');
            await daemonManager.start(isDevMode);
            console.log(`${isDevMode ? 'Agent' : 'Daemon'} installed and started successfully`);
            break;

        case 'uninstall':
            console.log(`Uninstalling Launch ${isDevMode ? 'Agent' : 'Daemon'}...`);
            await daemonManager.uninstall(isDevMode);
            console.log(`${isDevMode ? 'Agent' : 'Daemon'} uninstalled`);
            break;

        case 'restart':
            console.log(`Restarting Launch ${isDevMode ? 'Agent' : 'Daemon'}...`);
            await daemonManager.restart(isDevMode);
            console.log(`${isDevMode ? 'Agent' : 'Daemon'} restarted`);
            break;
    }
}

async function initApp(): Promise<HeadCounterApp> {
    const app = new HeadCounterApp(null);
    await app.initialize();
    return app;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const command = args[0] || 'status';

    // Commands that don't need full app initialization
    switch (command) {
        case 'server':
            await handleServerCommand(args.slice(1));
            return;

        case 'node':
            await handleNodeCommand(args.slice(1));
            return;

        case 'install':
        case 'uninstall':
        case 'restart':
            await handleDaemonCommand(command);
            return;

        default:
            break;
    }

    // Commands that require full app initialization
    const app = await initApp();

    switch (command) {
        case 'daemon':
            await app.start();
            
            process.on('SIGTERM', async () => {
                console.log('Received SIGTERM, shutting down...');
                await app.stop();
                process.exit(0);
            });
            
            process.on('SIGINT', async () => {
                console.log('Received SIGINT, shutting down...');
                await app.stop();
                process.exit(0);
            });
            
            break;
            
        case 'start':
            await app.start();
            break;
            
        case 'stop':
            await app.stopService();
            break;
            
        case 'capture':
            const result = await app.captureOnce();
            console.log(JSON.stringify(result));
            break;
            
        case 'status':
            const status = app.getStatus();
            console.log(JSON.stringify(status, null, 2));
            break;
            
        case 'save-config':
            const stdinData = fs.readFileSync('/dev/stdin', 'utf-8');
            try {
                const newConfig = JSON.parse(stdinData);
                app.saveUserConfig(newConfig);
                console.log(JSON.stringify({ success: true }));
            } catch (error) {
                console.log(JSON.stringify({ success: false, error: 'Invalid JSON' }));
            }
            break;
            
        // install, uninstall, restart handled above without full init
            
        case 'config':
            const handler = async (cmd: string, body?: any): Promise<any> => {
                switch (cmd) {
                    case '/status':
                        return app.getStatus();
                    case '/config':
                        return app.getConfig();
                    case '/capture':
                        return app.captureOnce();
                    case '/save-config':
                        app.saveUserConfig(body);
                        return { success: true };
                    case '/restart':
                        await app.restart();
                        return { success: true };
                    case '/stop':
                        await app.stop();
                        return { success: true };
                    case '/uninstall':
                        await app.uninstall();
                        return { success: true };
                    default:
                        return { error: 'Unknown command' };
                }
            };
            
            const server = new ConfigServer(handler);
            await server.start();
            server.openBrowser();
            
            process.on('SIGINT', async () => {
                await server.stop();
                process.exit(0);
            });
            
            process.on('SIGTERM', async () => {
                await server.stop();
                process.exit(0);
            });
            
            break;
            
        default:
            console.log('Usage: headcounter <command>');
            console.log('Commands:');
            console.log('  daemon      Run as daemon (called by launchd)');
            console.log('  start       Start the capture service');
            console.log('  stop        Stop the capture service');
            console.log('  capture     Perform a single capture');
            console.log('  status      Show current status');
            console.log('  save-config Update configuration (via stdin)');
            console.log('  install     Install Launch Daemon/Agent');
            console.log('  uninstall   Remove Launch Daemon/Agent');
            console.log('  restart     Restart the service');
            console.log('  config      Open configuration UI');
            console.log('  server      Server management (start|stop|status)');
            console.log('  node        Node management (register|list|revoke)');
            process.exit(1);
    }
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
