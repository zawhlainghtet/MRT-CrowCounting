import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThrottleRunner } from './throttle';
import { MlRunner, MlZoneResult } from './runner';

// Mock MlRunner
vi.mock('./runner');

describe('ThrottleRunner', () => {
    let mockMlRunner: any;
    let throttleRunner: ThrottleRunner;

    const mockResult: MlZoneResult = {
        headCount: 5,
        confidence: 0.9,
        processingTime: 1000,
        rawOutput: '{"success":true,"headCount":5}'
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockMlRunner = {
            processImageWithZones: vi.fn().mockResolvedValue(mockResult)
        };
        throttleRunner = new ThrottleRunner(mockMlRunner);
    });

    describe('execute', () => {
        it('starts ML inference when not busy', async () => {
            const result = await throttleRunner.execute({
                imagePath: '/path/to/image.jpg',
                capturedAt: new Date()
            });

            expect(result.success).toBe(true);
            expect(result.skipped).toBe(false);
            expect(result.result).toEqual(mockResult);
            expect(mockMlRunner.processImageWithZones).toHaveBeenCalledWith('/path/to/image.jpg');
        });

        it('skips new capture when ML is already running', async () => {
            // Delay the mock to simulate slow ML inference
            mockMlRunner.processImageWithZones.mockImplementation(() =>
                new Promise(resolve => setTimeout(() => resolve(mockResult), 100))
            );

            // Start first capture (don't await - let it run in background)
            const firstExecute = throttleRunner.execute({
                imagePath: '/path/to/first.jpg',
                capturedAt: new Date()
            });

            // Wait a tick to ensure first execute has entered the ML call
            await new Promise(resolve => setTimeout(resolve, 10));

            // While ML is running, try second capture
            const secondResult = await throttleRunner.execute({
                imagePath: '/path/to/second.jpg',
                capturedAt: new Date()
            });

            expect(secondResult.skipped).toBe(true);
            expect(secondResult.success).toBe(false);
            expect(secondResult.reason).toContain('already in progress');

            // Wait for first to complete
            await firstExecute;
        });

        it('reports skipped capture via callback', async () => {
            // Delay the mock to simulate slow ML inference
            mockMlRunner.processImageWithZones.mockImplementation(() =>
                new Promise(resolve => setTimeout(resolve, 100))
            );

            const onSkipped = vi.fn();
            throttleRunner.setCallbacks({ onSkipped });

            // Start first capture (don't await - let it run in background)
            throttleRunner.execute({
                imagePath: '/path/to/first.jpg',
                capturedAt: new Date()
            });

            // Wait a tick to ensure first execute has entered the ML call
            await new Promise(resolve => setTimeout(resolve, 10));

            // Try second capture while ML is running
            await throttleRunner.execute({
                imagePath: '/path/to/second.jpg',
                capturedAt: new Date()
            });

            expect(onSkipped).toHaveBeenCalledWith(
                '/path/to/second.jpg',
                expect.stringContaining('already in progress')
            );
        });

        it('reports result via callback when inference succeeds', async () => {
            const onResult = vi.fn();
            throttleRunner.setCallbacks({ onResult });

            await throttleRunner.execute({
                imagePath: '/path/to/image.jpg',
                capturedAt: new Date('2024-01-01T12:00:00Z')
            });

            expect(onResult).toHaveBeenCalledWith(mockResult, expect.any(Date));
        });

        it('returns error when ML inference fails', async () => {
            mockMlRunner.processImageWithZones.mockRejectedValue(new Error('ML crashed'));

            const result = await throttleRunner.execute({
                imagePath: '/path/to/image.jpg',
                capturedAt: new Date()
            });

            expect(result.success).toBe(false);
            expect(result.skipped).toBe(false);
            expect(result.reason).toBe('ML crashed');
        });

        it('handles multiple sequential executions correctly', async () => {
            const results = [];

            for (let i = 0; i < 3; i++) {
                const result = await throttleRunner.execute({
                    imagePath: `/path/to/image${i}.jpg`,
                    capturedAt: new Date()
                });
                results.push(result);
            }

            // All should succeed since they run sequentially
            expect(results.every(r => r.success && !r.skipped)).toBe(true);
            expect(mockMlRunner.processImageWithZones).toHaveBeenCalledTimes(3);
        });
    });

    describe('isActive', () => {
        it('returns false when idle', () => {
            expect(throttleRunner.isActive()).toBe(false);
        });

        it('returns true while inference is running', async () => {
            mockMlRunner.processImageWithZones.mockImplementation(() =>
                new Promise(resolve => setTimeout(() => resolve(mockResult), 50))
            );

            const executePromise = throttleRunner.execute({
                imagePath: '/path/to/image.jpg',
                capturedAt: new Date()
            });

            expect(throttleRunner.isActive()).toBe(true);

            await executePromise;
            expect(throttleRunner.isActive()).toBe(false);
        });
    });
});
