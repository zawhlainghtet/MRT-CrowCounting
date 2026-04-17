export interface ImageCaptureResult {
    success: boolean;
    imagePath?: string;
    error?: string;
    metadata?: {
        width: number;
        height: number;
        timestamp: Date;
    };
}

export interface CameraInfo {
    type: 'usb' | 'rtsp';
    name: string;
    resolution?: string;
    status: 'connected' | 'disconnected' | 'error';
}

export interface CameraSource {
    capture(): Promise<ImageCaptureResult>;
    testConnection(): Promise<boolean>;
    getInfo(): CameraInfo;
}
