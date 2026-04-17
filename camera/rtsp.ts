import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CameraSource, ImageCaptureResult, CameraInfo } from './index';

export class RtspCamera implements CameraSource {
    private url: string;
    private storageDir: string;
    private connected: boolean = false;

    constructor(rtspUrl: string, storageDir: string = '/usr/local/headcounter/captured_images') {
        this.url = rtspUrl;
        this.storageDir = storageDir;
        
        if (!fs.existsSync(this.storageDir)) {
            fs.mkdirSync(this.storageDir, { recursive: true });
        }
    }

    async capture(): Promise<ImageCaptureResult> {
        const timestamp = Date.now();
        const filename = `capture_${timestamp}.jpg`;
        const imagePath = path.join(this.storageDir, filename);

        return new Promise((resolve) => {
            const ffmpegCmd = [
                'ffmpeg',
                '-rtsp_transport',
                'tcp',
                '-i',
                this.url,
                '-vframes',
                '1',
                '-q:v',
                '2',
                '-y',
                imagePath
            ].join(' ');

            child_process.exec(ffmpegCmd, { timeout: 15000 }, (error, stdout, stderr) => {
                if (error) {
                    resolve({
                        success: false,
                        error: `RTSP capture failed: ${error.message}`
                    });
                    return;
                }

                if (!fs.existsSync(imagePath)) {
                    resolve({
                        success: false,
                        error: 'RTSP capture file not created'
                    });
                    return;
                }

                this.connected = true;
                
                let width = 1920;
                let height = 1080;
                
                const sizeMatch = stderr.match(/(\d+)x(\d+)/);
                if (sizeMatch) {
                    width = parseInt(sizeMatch[1]);
                    height = parseInt(sizeMatch[2]);
                }

                resolve({
                    success: true,
                    imagePath,
                    metadata: {
                        width,
                        height,
                        timestamp: new Date()
                    }
                });
            });
        });
    }

    async testConnection(): Promise<boolean> {
        try {
            const result = await this.capture();
            if (result.success && result.imagePath) {
                try {
                    fs.unlinkSync(result.imagePath);
                } catch {}
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    getInfo(): CameraInfo {
        return {
            type: 'rtsp',
            name: `RTSP Stream (${this.url})`,
            status: this.connected ? 'connected' : 'disconnected'
        };
    }
}
