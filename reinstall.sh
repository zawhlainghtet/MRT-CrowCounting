#!/bin/bash
echo "Reinstalling HeadCounter package..."

if [ "$EUID" -ne 0 ]; then
    echo "This script requires sudo. Running with sudo..."
    exec sudo "$0" "$@"
fi

echo "Removing old installation..."
rm -rf /usr/local/headcounter

echo "Installing new package..."
installer -pkg "$(dirname "$0")/HeadCounter-v1.0.0.pkg" -target /

echo ""
echo "Fixing permissions..."
chmod 777 /usr/local/headcounter/captured_images /usr/local/headcounter/logs /usr/local/headcounter/data

echo ""
echo "Checking permissions..."
ls -la /usr/local/headcounter/

echo ""
echo "Done!"
