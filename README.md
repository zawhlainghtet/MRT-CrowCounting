# HeadCounter for macOS

A head counting application for macOS with Launch Daemon support, camera capture, and ML inference placeholder.

## Features

- **Dual Camera Support**: USB Webcam (development) and RTSP Stream (production)
- **Launch Daemon**: Runs at system boot (production) or user login (development)
- **SQLite Storage**: Local database for image metadata and statistics
- **Configurable**: All settings via JSON configuration file
- **Minimal UI**: Tauri-based configuration interface

## Requirements

- macOS 13 (Ventura) or later
- Node.js 22+ (for development)
- FFmpeg (for RTSP capture)
- Go 1.21+ (for dummy CLI)

## Installation

```bash
# Build the package
./build-pkg.sh

# Install the package
sudo installer -pkg HeadCounter-v1.0.0.pkg -target /
```

## Configuration

Edit `/usr/local/headcounter/config/config.json`:

### Development Mode (USB Webcam)
```json
{
    "mode": "dev",
    "camera": {
        "type": "usb",
        "usb": {
            "device": "0",
            "resolution": "1280x720"
        }
    }
}
```

### Production Mode (RTSP Stream)
```json
{
    "mode": "prod",
    "camera": {
        "type": "rtsp",
        "rtsp": {
            "url": "rtsp://camera-ip:554/stream"
        }
    }
}
```

## Usage

```bash
# Start the service
headcounter start

# Stop the service
headcounter stop

# Perform a single capture
headcounter capture

# View status
headcounter status

# Open configuration UI
headcounter config

# Install as Launch Daemon/Agent
headcounter install

# Uninstall
headcounter uninstall
```

## Development

```bash
# Install dependencies
npm run install:deps

# Build TypeScript
npm run build

# Run in development mode
npm run dev
```

## Directory Structure

```
/usr/local/headcounter/
├── bin/
│   ├── headcounter      # Main executable
│   └── dummy-cli        # ML placeholder CLI
├── config/
│   └── config.json      # Configuration file
├── data/
│   └── storage.db       # SQLite database
├── captured_images/     # Captured images
└── logs/
    ├── app.log
    └── error.log
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Tauri UI Layer                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Node.js/TypeScript Core                       │
├─────────────────────────────────────────────────────────────────┤
│  Config Loader ──▶ Capture Controller ──▶ ML Runner            │
│         │                    │                                  │
│         ▼                    ▼                                  │
│  ┌───────────┐        ┌─────────────┐                          │
│  │   SQLite  │◀───────│  Storage    │                          │
│  └───────────┘        └─────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (Camera Abstraction)
┌─────────────────────────────────────────────────────────────────┐
│                    Camera Sources                               │
│  ┌────────────────────┐    ┌────────────────────┐              │
│  │ Dev: USB Webcam    │    │ Prod: RTSP Stream  │              │
│  │ (node-webcam)      │    │ (FFmpeg)           │              │
│  └────────────────────┘    └────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

## License

MIT
