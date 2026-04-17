import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';

const PLIST_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.headcounter.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/headcounter/bin/headcounter</string>
        <string>daemon</string>
    </array>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/headcounter.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/headcounter.error.log</string>
    <key>WorkingDirectory</key>
    <string>/usr/local/headcounter</string>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
`;

const AGENT_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.headcounter.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/headcounter/bin/headcounter</string>
        <string>daemon</string>
    </array>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>LimitLoadToSessionType</key>
    <string>Aqua</string>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/headcounter.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/headcounter.error.log</string>
    <key>WorkingDirectory</key>
    <string>/usr/local/headcounter</string>
</dict>
</plist>
`;

export class DaemonManager {
    private plistPath: string;
    private agentPath: string;

    constructor() {
        this.plistPath = '/Library/LaunchDaemons/com.headcounter.daemon.plist';
        const homeDir = this.getUserHome();
        this.agentPath = path.join(homeDir, 'Library/LaunchAgents/com.headcounter.agent.plist');
    }

    private getUserHome(): string {
        if (process.getuid && process.getuid() === 0) {
            const sudoUser = process.env.SUDO_USER;
            if (sudoUser) {
                const { execSync } = require('child_process');
                try {
                    const home = execSync(`dscl . -read /Users/${sudoUser} NFSHomeDirectory | cut -d' ' -f2`, { encoding: 'utf-8' }).trim();
                    if (home && home !== '') {
                        return home;
                    }
                } catch {
                }
            }
        }
        return process.env.HOME || process.env.USERPROFILE || '';
    }

    install(isDevMode: boolean): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const targetPath = isDevMode ? this.agentPath : this.plistPath;
                let content = isDevMode ? AGENT_CONTENT : PLIST_CONTENT;
                
                // launchd does not expand $HOME in plist files,
                // so resolve it at install time
                const homeDir = this.getUserHome();
                content = content.replace(/\$HOME/g, homeDir);
                
                fs.writeFileSync(targetPath, content);
                
                if (isDevMode) {
                    fs.chmodSync(targetPath, 0o644);
                } else {
                    fs.chmodSync(targetPath, 0o644);
                }

                if (!isDevMode) {
                    child_process.execSync(`chown root:wheel "${targetPath}"`);
                }

                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    uninstall(isDevMode: boolean): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const targetPath = isDevMode ? this.agentPath : this.plistPath;
                
                if (fs.existsSync(targetPath)) {
                    this.stop(isDevMode);
                    fs.unlinkSync(targetPath);
                }
                
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    start(isDevMode: boolean): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const targetPath = isDevMode ? this.agentPath : this.plistPath;
                
                if (!fs.existsSync(targetPath)) {
                    reject(new Error('Daemon/Agent not installed'));
                    return;
                }

                const cmd = isDevMode 
                    ? `launchctl load -w "${targetPath}"`
                    : `sudo launchctl load -w "${targetPath}"`;
                
                child_process.execSync(cmd, { stdio: 'inherit' });
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    stop(isDevMode: boolean): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const targetPath = isDevMode ? this.agentPath : this.plistPath;
                
                if (!fs.existsSync(targetPath)) {
                    resolve();
                    return;
                }

                if (!this.isRunning(isDevMode)) {
                    resolve();
                    return;
                }

                const cmd = isDevMode
                    ? `launchctl unload -w "${targetPath}"`
                    : `sudo launchctl unload -w "${targetPath}"`;
                
                child_process.execSync(cmd, { stdio: 'inherit' });
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    restart(isDevMode: boolean): Promise<void> {
        return new Promise(async (resolve, reject) => {
            try {
                await this.stop(isDevMode);
                await new Promise(r => setTimeout(r, 1000));
                await this.start(isDevMode);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    isRunning(isDevMode: boolean): boolean {
        const label = isDevMode ? 'com.headcounter.agent' : 'com.headcounter.daemon';
        
        try {
            const cmd = isDevMode
                ? `launchctl list | grep "${label}"`
                : `sudo launchctl list | grep "${label}"`;
            
            const output = child_process.execSync(cmd, { encoding: 'utf-8' });
            return output.includes(label) && !output.includes('does not exist');
        } catch {
            return false;
        }
    }

    getStatus(isDevMode: boolean): object {
        const label = isDevMode ? 'com.headcounter.agent' : 'com.headcounter.daemon';
        const plistPath = isDevMode ? this.agentPath : this.plistPath;
        
        return {
            installed: fs.existsSync(plistPath),
            running: this.isRunning(isDevMode),
            mode: isDevMode ? 'development' : 'production',
            label,
            plistPath
        };
    }
}
