#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
echo "=========================================="
echo "HeadCounter macOS Package Builder"
echo "=========================================="
VERSION="1.0.0"
TEMP_DIR="pkg-temp"
# Clean up any previous build artifacts
# Use subshell to prevent set -e from exiting on rm failure
(
    set +e
    rm -rf "$TEMP_DIR" 2>/dev/null
    rm -f "HeadCounter-v${VERSION}.pkg" 2>/dev/null
)
mkdir -p "$TEMP_DIR"

# Check if there are leftover root-owned files that we couldn't delete
LEFTOVER_DIR="$TEMP_DIR/root/usr/local/headcounter/bin/node_modules"
if [ -d "$LEFTOVER_DIR" ]; then
    echo ""
    echo "WARNING: Found leftover node_modules from a previous build that used sudo."
    echo "The packaged build will fail due to permission issues."
    echo ""
    echo "To fix this, run the following command ONCE to clean up:"
    echo "  sudo rm -rf pkg-temp"
    echo ""
    echo "After that, you can run ./build-pkg.sh normally."
    echo ""
    exit 1
fi
echo "[1/5] Building TypeScript..."
npm run build

echo "[2/5] Creating standalone binary with pkg..."
mkdir -p "$TEMP_DIR/bin"

# CRITICAL: Patch serialport-bindings.js BEFORE pkg runs.
# pkg snapshots node_modules into the binary, so the patch must be in place
# when pkg reads the files. We back up originals and restore after.
#
# The problem: node-gyp-build looks for .node prebuilds relative to __dirname,
# but inside a pkg snapshot __dirname is /snapshot/... where no real files exist.
# The fix: replace node-gyp-build() with a direct require() of the .node file
# from the known install path, with a fallback to node-gyp-build for dev mode.
echo "Patching serialport-bindings.js before pkg snapshot..."

PATCH_CONTENT='"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.binding = void 0;
// Patched for pkg: load native binding from known install path
var path = require("path");
var fs = require("fs");
var bindingPaths = [
    "/usr/local/headcounter/bin/node_modules/@serialport/bindings-cpp/prebuilds/darwin-x64+arm64/@serialport+bindings-cpp.node",
    path.join(path.dirname(process.execPath), "node_modules/@serialport/bindings-cpp/prebuilds/darwin-x64+arm64/@serialport+bindings-cpp.node")
];
var loaded = false;
for (var i = 0; i < bindingPaths.length; i++) {
    try {
        if (fs.existsSync(bindingPaths[i])) {
            exports.binding = require(bindingPaths[i]);
            loaded = true;
            break;
        }
    } catch (e) {}
}
if (!loaded) {
    // Fallback to node-gyp-build for dev mode
    var node_gyp_build = require("node-gyp-build");
    var join = require("path").join;
    exports.binding = node_gyp_build(join(__dirname, "../"));
}
'

BINDINGS_FILES=$(find node_modules -name "serialport-bindings.js" -path "*/bindings-cpp/dist/*")
for f in $BINDINGS_FILES; do
    echo "  Patching: $f"
    cp "$f" "$f.bak"
    echo "$PATCH_CONTENT" > "$f"
done

# Build for macOS arm64
pkg dist/main.js \
    -t latest-macos-arm64 \
    -o "$TEMP_DIR/bin/headcounter" \
    --compress Brotli

# Restore original files so dev mode still works
echo "Restoring original serialport-bindings.js..."
for f in $BINDINGS_FILES; do
    mv "$f.bak" "$f"
done

# Copy sql-wasm.wasm for sql.js
cp node_modules/sql.js/dist/sql-wasm.wasm "$TEMP_DIR/bin/"

echo "[3/5] Bundling node_modules for runtime..."
# Copy serialport native prebuilds (.node files) alongside the binary.
# The patched serialport-bindings.js (baked into the pkg binary) will
# require() these .node files from this location at runtime.
mkdir -p "$TEMP_DIR/bin/node_modules/@serialport/bindings-cpp/prebuilds"
cp -r node_modules/@serialport/bindings-cpp/prebuilds/* "$TEMP_DIR/bin/node_modules/@serialport/bindings-cpp/prebuilds/"

echo "Verifying native prebuilds:"
ls -la "$TEMP_DIR/bin/node_modules/@serialport/bindings-cpp/prebuilds/darwin-x64+arm64/"

echo "[4/5] Packaging ML components..."
# Copy Python ML script (CSRNet head counter)
cp machine-learning/CSRNet_RUN.py "$TEMP_DIR/bin/"
chmod 755 "$TEMP_DIR/bin/CSRNet_RUN.py"

# Copy ML model files (must be in same directory as script)
if ls machine-learning/*.pth* 1> /dev/null 2>&1; then
    cp machine-learning/*.pth* "$TEMP_DIR/bin/" 2>/dev/null || true
fi
echo "[4/5] Creating distribution pkg..."
mkdir -p "$TEMP_DIR/root/usr/local/headcounter"/{bin,config,data,captured_images,logs,scripts,ui}
mkdir -p "$TEMP_DIR/root/Library/LaunchDaemons"

# Copy all files and directories from bin (including node_modules for serial support)
cp -r "$TEMP_DIR/bin/"* "$TEMP_DIR/root/usr/local/headcounter/bin/"

echo "Verifying root bin contents:"
ls -la "$TEMP_DIR/root/usr/local/headcounter/bin/"

cp resources/default-config.json "$TEMP_DIR/root/usr/local/headcounter/config/config.json"
cp resources/dev-config.json "$TEMP_DIR/root/usr/local/headcounter/config/dev-config.json"
cp resources/config-ui.html "$TEMP_DIR/root/usr/local/headcounter/ui/"
cp resources/scripts/com.headcounter.plist "$TEMP_DIR/root/Library/LaunchDaemons/"
chmod 755 "$TEMP_DIR/root/usr/local/headcounter/bin/"
chmod 755 "$TEMP_DIR/root/usr/local/headcounter/bin/"*
chmod 666 "$TEMP_DIR/root/usr/local/headcounter/config/config.json"
chmod 666 "$TEMP_DIR/root/usr/local/headcounter/config/dev-config.json"
chmod 777 "$TEMP_DIR/root/usr/local/headcounter/config"
chmod 644 "$TEMP_DIR/root/usr/local/headcounter/ui/config-ui.html"
chmod 644 "$TEMP_DIR/root/Library/LaunchDaemons/com.headcounter.plist"
chmod 777 "$TEMP_DIR/root/usr/local/headcounter/captured_images"
chmod 777 "$TEMP_DIR/root/usr/local/headcounter/logs"
chmod 777 "$TEMP_DIR/root/usr/local/headcounter/data"
mkdir -p "$TEMP_DIR/scripts"
cat > "$TEMP_DIR/scripts/preinstall" << 'PREINST'
#!/bin/bash
set -e

# Stop and unload any existing Launch Daemon
if [ -f /Library/LaunchDaemons/com.headcounter.plist ]; then
    launchctl unload -w /Library/LaunchDaemons/com.headcounter.plist 2>/dev/null || true
fi

# Stop and unload any existing Launch Agent for the installing user
INSTALLING_USER="${USER}"
if [ -n "$SUDO_USER" ]; then
    INSTALLING_USER="$SUDO_USER"
fi
AGENT_PLIST="/Users/${INSTALLING_USER}/Library/LaunchAgents/com.headcounter.agent.plist"
if [ -f "$AGENT_PLIST" ]; then
    su "$INSTALLING_USER" -c "launchctl unload -w '$AGENT_PLIST'" 2>/dev/null || true
    rm -f "$AGENT_PLIST"
fi

# Kill any remaining headcounter processes
pkill -f "headcounter daemon" 2>/dev/null || true

# Remove old installation but preserve user data
if [ -d /usr/local/headcounter ]; then
    # Back up user config and captured images
    BACKUP_DIR=$(mktemp -d)
    [ -f /usr/local/headcounter/config/config.json ] && cp /usr/local/headcounter/config/config.json "$BACKUP_DIR/config.json"
    [ -d /usr/local/headcounter/captured_images ] && cp -r /usr/local/headcounter/captured_images "$BACKUP_DIR/captured_images"
    [ -d /usr/local/headcounter/data ] && cp -r /usr/local/headcounter/data "$BACKUP_DIR/data"

    rm -rf /usr/local/headcounter

    # Restore user data
    mkdir -p /usr/local/headcounter/config /usr/local/headcounter/captured_images /usr/local/headcounter/data
    [ -f "$BACKUP_DIR/config.json" ] && cp "$BACKUP_DIR/config.json" /usr/local/headcounter/config/config.json
    [ -d "$BACKUP_DIR/captured_images" ] && cp -r "$BACKUP_DIR/captured_images/"* /usr/local/headcounter/captured_images/ 2>/dev/null || true
    [ -d "$BACKUP_DIR/data" ] && cp -r "$BACKUP_DIR/data/"* /usr/local/headcounter/data/ 2>/dev/null || true
    rm -rf "$BACKUP_DIR"
fi

mkdir -p /usr/local/headcounter/{bin,config,data,captured_images,logs,scripts,ui}

exit 0
PREINST
cat > "$TEMP_DIR/scripts/postinstall" << 'POSTINST'
#!/bin/bash
set -e

# Fix binary permissions
chmod 755 /usr/local/headcounter/bin/*

# Fix config permissions
chmod 777 /usr/local/headcounter/config
chmod 666 /usr/local/headcounter/config/config.json
chmod 666 /usr/local/headcounter/config/dev-config.json

# Fix data directory permissions
chmod 777 /usr/local/headcounter/captured_images
chmod 777 /usr/local/headcounter/logs
chmod 777 /usr/local/headcounter/data

# Fix UI permissions
chmod 644 /usr/local/headcounter/ui/config-ui.html

# Fix native module permissions (serialport .node files need execute)
if [ -d /usr/local/headcounter/bin/node_modules ]; then
    chmod -R 755 /usr/local/headcounter/bin/node_modules
fi

# Fix Launch Daemon plist
if [ -f /Library/LaunchDaemons/com.headcounter.plist ]; then
    chmod 644 /Library/LaunchDaemons/com.headcounter.plist
    chown root:wheel /Library/LaunchDaemons/com.headcounter.plist
fi

# Create symlink so `headcounter` is available on PATH
mkdir -p /usr/local/bin
ln -sf /usr/local/headcounter/bin/headcounter /usr/local/bin/headcounter

exit 0
POSTINST
chmod 755 "$TEMP_DIR/scripts/preinstall"
chmod 755 "$TEMP_DIR/scripts/postinstall"
# pkgbuild creates the pkg with install scripts (simpler than productbuild)
pkgbuild --identifier com.headcounter.app \
    --version "$VERSION" \
    --root "$TEMP_DIR/root" \
    --install-location / \
    --scripts "$TEMP_DIR/scripts" \
    "HeadCounter-v${VERSION}.pkg"
echo "[5/5] Cleaning up..."
rm -rf "$TEMP_DIR"
echo ""
echo "=========================================="
echo "Package created: HeadCounter-v${VERSION}.pkg"
echo "=========================================="
echo ""
echo "To install: sudo installer -pkg HeadCounter-v${VERSION}.pkg -target /"
echo ""
