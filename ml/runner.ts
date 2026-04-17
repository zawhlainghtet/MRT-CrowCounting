import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface MlResult {
    headCount: number;
    confidence: number;
    processingTime: number;
    rawOutput?: string;
}

export interface MlZoneResult extends MlResult {
    zones?: {
        far?: number;
        stand?: number;
        seat_left?: number;
        seat_right?: number;
    };
}

export class MlRunner {
    private command: string;
    private timeoutSeconds: number;
    private runAsUser: string | null;

    constructor(command: string, timeoutSeconds: number = 30, runAsUser: string | null = null) {
        this.command = command;
        this.timeoutSeconds = timeoutSeconds;
        this.runAsUser = runAsUser;
    }

    async processImage(imagePath: string): Promise<number> {
        if (!fs.existsSync(imagePath)) {
            throw new Error(`Image file not found: ${imagePath}`);
        }

        const result = await this.runCommand(imagePath);
        return result.headCount;
    }

    async processImageWithZones(imagePath: string): Promise<MlZoneResult> {
        if (!fs.existsSync(imagePath)) {
            throw new Error(`Image file not found: ${imagePath}`);
        }

        return this.runCommand(imagePath) as Promise<MlZoneResult>;
    }

    private async runCommand(imagePath: string): Promise<MlResult> {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const timeoutMs = this.timeoutSeconds * 1000;

            const { executable, args, useSudo } = this.buildCommand(imagePath);

            if (useSudo && this.runAsUser) {
                // Use sudo -u to run as the specified user
                // Need to use exec with shell to properly handle sudo
                const sudoCommand = `${executable} ${args.join(' ')}`;
                const fullCommand = `sudo -u ${this.runAsUser} ${sudoCommand}`;
                child_process.exec(fullCommand, { timeout: timeoutMs }, (error, stdout, stderr) => {
                    const processingTime = Date.now() - startTime;
                    const rawOutput = stdout.trim();

                    if (error) {
                        console.error(`ML command failed (sudo): ${stderr || error.message}`);
                        resolve({ headCount: 0, confidence: 0.0, processingTime, rawOutput });
                        return;
                    }

                    try {
                        const result = this.parseOutput(rawOutput, processingTime);
                        resolve({ ...result, rawOutput });
                    } catch (parseError) {
                        console.error(`Failed to parse ML output: ${rawOutput}`);
                        resolve({ headCount: 0, confidence: 0.0, processingTime, rawOutput });
                    }
                });
            } else {
                child_process.execFile(
                    executable,
                    args,
                    { timeout: timeoutMs },
                    (error, stdout, stderr) => {
                        const processingTime = Date.now() - startTime;
                        const rawOutput = stdout.trim();

                        if (error) {
                            console.error(`ML command failed: ${stderr || error.message}`);
                            resolve({ headCount: 0, confidence: 0.0, processingTime, rawOutput });
                            return;
                        }

                        try {
                            const result = this.parseOutput(rawOutput, processingTime);
                            resolve({ ...result, rawOutput });
                        } catch (parseError) {
                            console.error(`Failed to parse ML output: ${rawOutput}`);
                            resolve({ headCount: 0, confidence: 0.0, processingTime, rawOutput });
                        }
                    }
                );
            }
        });
    }

    /**
     * Find python3 executable that has torch installed.
     * Tries multiple common locations and verifies torch is available.
     */
    private findPython3(): string {
        const candidates = [
            // Pyenv versions (torch is installed here)
            '/Users/naingaungluu/.pyenv/versions/3.9.21/bin/python3.9',
            '/Users/naingaungluu/.pyenv/versions/3.9.21/bin/python3',
            // Homebrew Python (may not have torch)
            '/opt/homebrew/bin/python3',
            '/opt/homebrew/bin/python3.14',
            '/opt/homebrew/bin/python3.12',
            '/opt/homebrew/bin/python3.11',
            // System Python
            '/usr/bin/python3',
            '/usr/local/bin/python3.11',
            '/usr/local/bin/python3.10',
            '/usr/local/bin/python3.9',
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate) && this.pythonHasTorch(candidate)) {
                return candidate;
            }
        }

        // Fallback to plain 'python3' and let execFile handle the error
        return 'python3';
    }

    /**
     * Check if a Python executable has torch installed.
     */
    private pythonHasTorch(pythonPath: string): boolean {
        try {
            const { execSync } = require('child_process');
            execSync(`${pythonPath} -c "import torch"`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    private buildCommand(imagePath: string): { executable: string; args: string[]; useSudo: boolean } {
        const ext = path.extname(this.command).toLowerCase();
        const isPython = ext === '.py';

        // Check if we need sudo to run as a different user
        const currentUser = require('os').userInfo().username;
        const pythonPath = this.findPython3();
        // Only need sudo if:
        // 1. We have a runAsUser specified AND
        // 2. The current user is different AND
        // 3. We're NOT using a direct pyenv path (which has torch installed)
        const isPyenvPath = pythonPath.includes('.pyenv/versions/');
        const needsSudo = !!(this.runAsUser && this.runAsUser !== currentUser && !isPyenvPath);

        if (isPython) {
            return {
                executable: pythonPath,
                args: [this.command, imagePath],
                useSudo: needsSudo
            };
        }

        // Go/other binary - use direct command with image path as arg
        return {
            executable: this.command,
            args: [imagePath],
            useSudo: needsSudo
        };
    }

    private parseOutput(output: string, processingTime: number): MlResult {
        // Try to extract JSON from output
        const jsonMatch = output.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);

                // Handle failed CSRNet response
                if ('success' in parsed && parsed.success === false) {
                    console.error(`ML error: ${parsed.error || 'Unknown error'}`);
                    return {
                        headCount: 0,
                        confidence: 0.0,
                        processingTime: parsed.processingTime || processingTime
                    };
                }

                // Legacy dummy-cli format: check first (has avgConfidence)
                if (!('success' in parsed) && 'avgConfidence' in parsed) {
                    return {
                        headCount: parsed.headCount ?? parsed.heads ?? parsed.count ?? 0,
                        confidence: parsed.confidence ?? parsed.avgConfidence ?? 0.0,
                        processingTime: parsed.processingTime ?? processingTime
                    };
                }

                // CSRNet format: { success, headCount, confidence, zones, total, processingTime }
                if ('headCount' in parsed || 'total' in parsed) {
                    return {
                        headCount: parsed.headCount ?? parsed.total ?? 0,
                        confidence: parsed.confidence ?? 1.0,
                        processingTime: parsed.processingTime || processingTime,
                        zones: parsed.zones
                    } as MlZoneResult;
                }

                // Generic format: { headCount, confidence, processingTime }
                if ('headCount' in parsed || 'heads' in parsed || 'count' in parsed) {
                    return {
                        headCount: parsed.headCount ?? parsed.heads ?? parsed.count ?? 0,
                        confidence: parsed.confidence ?? 0.0,
                        processingTime: parsed.processingTime ?? processingTime
                    };
                }
            } catch {
                console.log('JSON parse failed, using fallback');
            }
        }

        // Fallback: try to extract any number from output
        const numberMatch = output.match(/(\d+)/);
        if (numberMatch) {
            return {
                headCount: parseInt(numberMatch[1], 10),
                confidence: 0.0,
                processingTime
            };
        }

        return {
            headCount: 0,
            confidence: 0.0,
            processingTime
        };
    }

    async testCommand(): Promise<boolean> {
        try {
            const { executable, args } = this.buildCommand('--help');
            return new Promise((resolve) => {
                child_process.execFile(
                    executable,
                    args,
                    { timeout: 5000 },
                    (error) => {
                        // Python scripts may exit with error on --help, that's ok
                        if (error && !error.message.includes('non-zero')) {
                            resolve(false);
                            return;
                        }
                        resolve(true);
                    }
                );
            });
        } catch {
            return false;
        }
    }
}
