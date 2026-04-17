import { MlRunner, MlZoneResult } from './runner';

export interface ThrottledCapture {
    imagePath: string;
    capturedAt: Date;
}

export interface ThrottleResult {
    success: boolean;
    skipped: boolean;
    result?: MlZoneResult;
    reason?: string;
}

/**
 * ThrottleRunner ensures ML inference runs without blocking.
 * If inference is already in progress, new captures are skipped (Approach B).
 * This prevents deadlock where new captures continuously cancel running ones.
 */
export class ThrottleRunner {
    private mlRunner: MlRunner;
    private isRunning: boolean = false;
    private onResult?: (result: MlZoneResult, capturedAt: Date) => void;
    private onSkipped?: (imagePath: string, reason: string) => void;

    constructor(mlRunner: MlRunner) {
        this.mlRunner = mlRunner;
    }

    /**
     * Set callbacks for results and skipped captures
     */
    setCallbacks(callbacks: {
        onResult?: (result: MlZoneResult, capturedAt: Date) => void;
        onSkipped?: (imagePath: string, reason: string) => void;
    }): void {
        this.onResult = callbacks.onResult;
        this.onSkipped = callbacks.onSkipped;
    }

    /**
     * Attempt to execute ML inference.
     * Returns immediately - either starts async inference or skips if busy.
     * 
     * @returns ThrottleResult indicating if inference was started or skipped
     */
    async execute(capture: ThrottledCapture): Promise<ThrottleResult> {
        if (this.isRunning) {
            const reason = 'ML inference already in progress';
            this.onSkipped?.(capture.imagePath, reason);
            return { success: false, skipped: true, reason };
        }

        this.isRunning = true;

        try {
            const result = await this.mlRunner.processImageWithZones(capture.imagePath);
            this.onResult?.(result, capture.capturedAt);
            return { success: true, skipped: false, result };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return { success: false, skipped: false, reason: errorMessage };
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Check if ML inference is currently running
     */
    isActive(): boolean {
        return this.isRunning;
    }
}
