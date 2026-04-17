#!/usr/bin/env node

/**
 * Server-only entry point for Docker/Linux deployment.
 * This bypasses the Tauri UI and macOS-specific dependencies.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from './config/loader';
import { StorageDatabase } from './storage/database';
import { Server } from './server/index';

const DEFAULT_CONFIG_PATH = '/usr/local/headcounter/config/config.json';
const SERVER_PORT = 3456;

function getBinaryDir(): string {
    return path.dirname(process.execPath);
}

function resolveAppPath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
        return relativePath;
    }
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

let serverInstance: Server | null = null;

async function handleServerCommand(args: string[]): Promise<void> {
    const subCommand = args[0];

    if (!subCommand || !['start', 'stop', 'status'].includes(subCommand)) {
        console.log('Usage: headcounter-server server <command>');
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
            
            serverInstance = new Server(SERVER_PORT);
            await serverInstance.start(storageDir);
            
            console.log(`HeadCounter Server running on port ${SERVER_PORT}`);
            
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
            try {
                const statusConfig = loadConfig(findConfigPath());
                const statusStorageDir = resolveAppPath(statusConfig.storage.directory);
                const tempDb = new StorageDatabase(statusStorageDir);
                await tempDb.initialize();
                
                const nodes = tempDb.getAllNodes();
                const online = nodes.filter(n => n.status === 'online').length;
                
                console.log(JSON.stringify({
                    running: serverInstance?.isRunning() || false,
                    port: SERVER_PORT,
                    nodeCount: nodes.length,
                    onlineCount: online,
                    offlineCount: nodes.length - online
                }, null, 2));
                
                tempDb.close();
            } catch (error) {
                console.log(JSON.stringify({
                    running: serverInstance?.isRunning() || false,
                    port: SERVER_PORT,
                    error: error instanceof Error ? error.message : String(error)
                }, null, 2));
            }
            break;
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

async function handleNodeCommand(args: string[]): Promise<void> {
    const subCommand = args[0];

    if (!subCommand || !['register', 'list', 'revoke'].includes(subCommand)) {
        console.log('Usage: headcounter-server node <command>');
        console.log('Commands:');
        console.log('  register [name]  Register a new node');
        console.log('  list            List all nodes');
        console.log('  revoke <id>     Revoke a node');
        return;
    }

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
                    console.log('Usage: headcounter-server node revoke <node-id>');
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

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command) {
        console.log('Usage: headcounter-server <command>');
        console.log('Commands:');
        console.log('  server <command>  Server management (start|stop|status)');
        console.log('  node <command>    Node management (register|list|revoke)');
        process.exit(1);
    }

    switch (command) {
        case 'server':
            await handleServerCommand(args.slice(1));
            break;

        case 'node':
            await handleNodeCommand(args.slice(1));
            break;

        default:
            console.log(`Unknown command: ${command}`);
            console.log('Usage: headcounter-server <command>');
            process.exit(1);
    }
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
