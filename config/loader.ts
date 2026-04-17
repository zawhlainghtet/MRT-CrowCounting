import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface CameraConfig {
    type: 'usb' | 'rtsp';
    usb: {
        device: string;
        resolution: string;
        framerate?: number;
        runAsUser?: string;
    };
    rtsp: {
        url: string;
    };
}

export interface CaptureConfig {
    imageFormat: string;
}

export interface StorageConfig {
    directory: string;
    maxTotalSizeMB: number;
    cleanupEnabled: boolean;
}

export interface MlConfig {
    command: string;
    timeoutSeconds: number;
}

export interface LoggingConfig {
    level: string;
    path: string;
}

export interface ServerConfig {
    url: string;
    token: string;
    heartbeatIntervalSeconds: number;
}

export interface SerialConfig {
    enabled: boolean;
    port: string;
    baudRate: number;
    cooldownMs: number;
}

export interface Config {
    mode: 'dev' | 'prod';
    camera: CameraConfig;
    capture: CaptureConfig;
    storage: StorageConfig;
    ml: MlConfig;
    logging: LoggingConfig;
    server?: ServerConfig;
    serial?: SerialConfig;
}

export class ConfigLoaderError extends Error {
    constructor(message: string, public code?: string) {
        super(message);
        this.name = 'ConfigLoaderError';
    }
}

export function loadConfig(configPath: string): Config {
    if (!fs.existsSync(configPath)) {
        throw new ConfigLoaderError(
            `Configuration file not found: ${configPath}`,
            'CONFIG_NOT_FOUND'
        );
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    
    let config: Partial<Config>;
    try {
        config = JSON.parse(content);
    } catch (error) {
        throw new ConfigLoaderError(
            `Invalid JSON in configuration file: ${error}`,
            'INVALID_JSON'
        );
    }

    const errors: string[] = [];
    
    if (!config.mode || !['dev', 'prod'].includes(config.mode)) {
        errors.push('mode must be "dev" or "prod"');
    }
    
    if (!config.camera || !config.camera.type) {
        errors.push('camera.type must be "usb" or "rtsp"');
    }
    
    if (!config.storage || !config.storage.directory) {
        errors.push('storage.directory must be specified');
    }
    
    if (!config.ml || !config.ml.command) {
        errors.push('ml.command must be specified');
    }

    if (errors.length > 0) {
        throw new ConfigLoaderError(
            `Configuration validation failed: ${errors.join(', ')}`,
            'VALIDATION_ERROR'
        );
    }

    const mode = config.mode as 'dev' | 'prod';
    const camera = config.camera!;
    const capture = config.capture!;
    const storage = config.storage!;
    const ml = config.ml!;

    return {
        mode,
        camera: {
            type: camera.type,
            usb: {
                device: camera.usb?.device || '0',
                resolution: camera.usb?.resolution || '1920x1080',
                framerate: camera.usb?.framerate,
                runAsUser: camera.usb?.runAsUser || os.userInfo().username
            },
            rtsp: {
                url: camera.rtsp?.url || ''
            }
        },
        capture: {
            imageFormat: capture.imageFormat || 'jpeg'
        },
        storage: {
            directory: storage.directory,
            maxTotalSizeMB: storage.maxTotalSizeMB || 1000,
            cleanupEnabled: storage.cleanupEnabled !== false
        },
        ml: {
            command: ml.command,
            timeoutSeconds: ml.timeoutSeconds || 30
        },
        logging: {
            level: config.logging?.level || 'info',
            path: config.logging?.path || '/usr/local/headcounter/logs'
        },
        server: config.server ? {
            url: config.server.url || '',
            token: config.server.token || '',
            heartbeatIntervalSeconds: config.server.heartbeatIntervalSeconds || 30
        } : undefined,
        serial: config.serial ? {
            enabled: config.serial.enabled || false,
            port: config.serial.port || '',
            baudRate: config.serial.baudRate || 115200,
            cooldownMs: config.serial.cooldownMs || 3000
        } : undefined
    };
}

export function saveConfig(configPath: string, config: Config): void {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
