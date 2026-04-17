import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MlRunner, MlResult } from './runner';
import * as child_process from 'child_process';

vi.mock('child_process');
vi.mock('fs');

describe('MlRunner', () => {
    let runner: MlRunner;

    beforeEach(() => {
        runner = new MlRunner('dummy-cli');
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('parseOutput - CSRNet JSON format', () => {
        it('parses successful CSRNet response with headCount', () => {
            const output = JSON.stringify({
                success: true,
                headCount: 15,
                confidence: 1.0,
                zones: { far: 5, stand: 7, seat_left: 2, seat_right: 1 },
                total: 15,
                processingTime: 1234
            });

            const result = parsePrivateResult(runner, output, 100);
            expect(result.headCount).toBe(15);
            expect(result.confidence).toBe(1.0);
            expect((result as any).processingTime).toBe(1234);
        });

        it('parses CSRNet response using total field as headCount', () => {
            const output = JSON.stringify({
                success: true,
                total: 23,
                confidence: 1.0,
                zones: { far: 10, stand: 8, seat_left: 3, seat_right: 2 },
                processingTime: 2000
            });

            const result = parsePrivateResult(runner, output, 100);
            expect(result.headCount).toBe(23);
        });

        it('parses CSRNet response with zones included', () => {
            const output = JSON.stringify({
                success: true,
                headCount: 12,
                confidence: 1.0,
                zones: {
                    far: 4,
                    stand: 5,
                    seat_left: 2,
                    seat_right: 1
                },
                processingTime: 1500
            });

            const result = parsePrivateResult(runner, output, 100);
            expect(result.headCount).toBe(12);
            // zones is returned but not in MlResult type - accessed via any
            expect((result as any).zones).toEqual({
                far: 4,
                stand: 5,
                seat_left: 2,
                seat_right: 1
            });
        });

        it('handles failed CSRNet response gracefully', () => {
            const output = JSON.stringify({
                success: false,
                error: 'Model weights not found',
                headCount: 0,
                zones: {},
                processingTime: 0
            });

            const result = parsePrivateResult(runner, output, 100);
            expect(result.headCount).toBe(0);
            expect(result.confidence).toBe(0.0);
        });

        it('parses embedded JSON in console output', () => {
            const output = `Loading model...
{"success": true, "headCount": 8, "confidence": 1.0, "zones": {"far": 2, "stand": 4, "seat_left": 1, "seat_right": 1}, "processingTime": 987}
Model ready.`;

            const result = parsePrivateResult(runner, output, 100);
            expect(result.headCount).toBe(8);
        });
    });

    describe('parseOutput - Legacy dummy-cli format', () => {
        it('parses dummy-cli format with headCount', () => {
            const output = JSON.stringify({
                headCount: 5,
                confidence: 0.75,
                processingTime: 50
            });

            const result = parsePrivateResult(runner, output, 100);
            expect(result.headCount).toBe(5);
            expect(result.confidence).toBe(0.75);
            expect(result.processingTime).toBe(50);
        });

        it('parses dummy-cli format with heads field', () => {
            const output = JSON.stringify({
                heads: 10,
                confidence: 0.85,
                processingTime: 30
            });

            const result = parsePrivateResult(runner, output, 100);
            expect(result.headCount).toBe(10);
        });

        it('parses dummy-cli format with count field', () => {
            const output = JSON.stringify({
                count: 7,
                confidence: 0.90,
                processingTime: 40
            });

            const result = parsePrivateResult(runner, output, 100);
            expect(result.headCount).toBe(7);
        });

        it('uses avgConfidence as fallback', () => {
            const output = JSON.stringify({
                headCount: 3,
                avgConfidence: 0.65
            });

            const result = parsePrivateResult(runner, output, 100);
            expect(result.headCount).toBe(3);
            expect(result.confidence).toBe(0.65);
        });
    });

    describe('parseOutput - Fallback patterns', () => {
        it('extracts number from plain text output', () => {
            const output = 'Estimated people count: 42';

            const result = parsePrivateResult(runner, output, 100);
            expect(result.headCount).toBe(42);
            expect(result.confidence).toBe(0.0);
        });

        it('returns zero headCount for unparseable output', () => {
            const output = 'Some random text without numbers';

            const result = parsePrivateResult(runner, output, 100);
            expect(result.headCount).toBe(0);
        });

        it('uses default processingTime when not in JSON', () => {
            const output = JSON.stringify({ headCount: 5 });

            const result = parsePrivateResult(runner, output, 500);
            expect(result.processingTime).toBe(500);
        });
    });

    describe('buildCommand', () => {
        it('builds command for Python script', () => {
            const pythonRunner = new MlRunner('machine-learning/CSRNet_RUN.py');
            const { executable, args } = buildPrivateCommand(pythonRunner, 'test.jpg');

            expect(executable).toBe('python3');
            expect(args).toEqual(['machine-learning/CSRNet_RUN.py', 'test.jpg']);
        });

        it('builds command for Go binary directly', () => {
            const binaryRunner = new MlRunner('bin/dummy-cli');
            const { executable, args } = buildPrivateCommand(binaryRunner, 'test.jpg');

            expect(executable).toBe('bin/dummy-cli');
            expect(args).toEqual(['test.jpg']);
        });

        it('handles .py extension detection', () => {
            const pythonRunner = new MlRunner('/path/to/script.py');
            const { executable } = buildPrivateCommand(pythonRunner, 'image.jpeg');

            expect(executable).toBe('python3');
        });
    });
});

// Helper functions to access private methods for testing
function parsePrivateResult(runner: MlRunner, output: string, processingTime: number): MlResult {
    // Access private method via type assertion
    return (runner as any).parseOutput(output, processingTime);
}

function buildPrivateCommand(runner: MlRunner, imagePath: string): { executable: string; args: string[] } {
    return (runner as any).buildCommand(imagePath);
}
