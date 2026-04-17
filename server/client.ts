import axios from 'axios';

export interface ServerConfig {
    url: string;
    token: string;
    heartbeatIntervalSeconds: number;
}

export class ServerClient {
    private url: string;
    private token: string;
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private onHeartbeatCallback: (() => Promise<void>) | null = null;

    constructor(config: ServerConfig) {
        this.url = config.url.replace(/\/$/, '');
        this.token = config.token;
    }

    private getHeaders() {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
        };
    }

    async sendHeartbeat(): Promise<boolean> {
        try {
            await axios.post(`${this.url}/api/heartbeat`, {}, {
                headers: this.getHeaders(),
                timeout: 10000
            });
            return true;
        } catch (error) {
            console.error('Heartbeat failed:', error instanceof Error ? error.message : String(error));
            return false;
        }
    }

    async sendCount(count: number, capturedAt?: Date): Promise<boolean> {
        try {
            await axios.post(`${this.url}/api/count`, {
                count,
                capturedAt: (capturedAt || new Date()).toISOString()
            }, {
                headers: this.getHeaders(),
                timeout: 10000
            });
            return true;
        } catch (error) {
            console.error('Send count failed:', error instanceof Error ? error.message : String(error));
            return false;
        }
    }

    startHeartbeat(intervalSeconds: number, onBeat?: () => Promise<void>): void {
        this.stopHeartbeat();
        
        if (onBeat) {
            this.onHeartbeatCallback = onBeat;
        }

        this.sendHeartbeat().then(() => {
            if (this.onHeartbeatCallback) {
                this.onHeartbeatCallback();
            }
        });

        this.heartbeatInterval = setInterval(async () => {
            const success = await this.sendHeartbeat();
            if (success && this.onHeartbeatCallback) {
                this.onHeartbeatCallback();
            }
        }, intervalSeconds * 1000);
    }

    stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            await axios.get(`${this.url}/api/status`, { timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }
}
