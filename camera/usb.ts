import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CameraSource, ImageCaptureResult, CameraInfo } from './index';

export class UsbCamera implements CameraSource {
    private device: string;
    private resolution: string;
    private framerate: number;
    private storageDir: string;
    private runAsUser: string | null;
    private connected: boolean = false;

    constructor(device: string = '0', resolution: string = '1920x1080', storageDir: string = '/usr/local/headcounter/captured_images', runAsUser: string | null = null, framerate: number = 60) {
        this.device = device;
        this.resolution = resolution;
        this.storageDir = storageDir;
        this.runAsUser = runAsUser;
        this.framerate = framerate;
        
        if (!fs.existsSync(this.storageDir)) {
            fs.mkdirSync(this.storageDir, { recursive: true });
        }
    }

    async capture(): Promise<ImageCaptureResult> {
        const timestamp = Date.now();
        const filename = `capture_${timestamp}.jpg`;
        const imagePath = path.join(this.storageDir, filename);
        const [width, height] = this.resolution.split('x');

        return new Promise((resolve) => {
            const ffmpegPath = fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' 
                : fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' 
                : 'ffmpeg';
            const ffmpegBase = `${ffmpegPath} -f avfoundation -framerate ${this.framerate} -video_size ${this.resolution} -i "${this.device}" -pix_fmt nv12 -vframes 1 -c:v mjpeg -y "${imagePath}" 2>&1`;
            // Only use sudo -u when running as a different user (e.g. daemon running as root).
            // Skip if we're already running as the target user (e.g. launch agent context).
            const currentUser = require('os').userInfo().username;
            const needsSudo = this.runAsUser && this.runAsUser !== currentUser;
            const ffmpegCmd = needsSudo
                ? `sudo -u ${this.runAsUser} ${ffmpegBase}`
                : ffmpegBase;
            
            child_process.exec(ffmpegCmd, { timeout: 10000 }, (error, stdout, stderr) => {
                if (error) {
                    const output = (stdout || '') + (stderr || '');
                    resolve({
                        success: false,
                        error: `FFmpeg capture failed: ${output.trim() || error.message}`
                    });
                    return;
                }

                if (!fs.existsSync(imagePath)) {
                    resolve({
                        success: false,
                        error: 'Capture file not created'
                    });
                    return;
                }

                this.connected = true;
                resolve({
                    success: true,
                    imagePath,
                    metadata: {
                        width: parseInt(width),
                        height: parseInt(height),
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
            type: 'usb',
            name: `USB Camera (${this.device})`,
            resolution: this.resolution,
            status: this.connected ? 'connected' : 'disconnected'
        };
    }
}
