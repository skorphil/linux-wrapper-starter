#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY="$ROOT_DIR/dist/linux-wrapper-helper"
CONFIG_DIR="$ROOT_DIR/config"
SERVICE="org.linux_wrapper_starter.Helper1"

echo "Compiling helper..."
mkdir -p "$ROOT_DIR/dist"
(cd "$ROOT_DIR/packages/helper" && deno compile --allow-all --output "$BINARY" main.ts)

echo "Installing helper (requires sudo)..."
sudo install -Dm755 "$BINARY" /usr/libexec/linux-wrapper-helper
sudo install -Dm644 "$CONFIG_DIR/$SERVICE.service" /usr/share/dbus-1/system-services/$SERVICE.service
sudo install -Dm644 "$CONFIG_DIR/$SERVICE.conf" /etc/dbus-1/system.d/$SERVICE.conf
sudo install -Dm644 "$CONFIG_DIR/$SERVICE.policy" /usr/share/polkit-1/actions/$SERVICE.policy

echo "Reloading D-Bus..."
if systemctl is-active --quiet dbus-broker; then
  sudo systemctl reload dbus-broker
else
  sudo systemctl reload dbus
fi

echo "Helper installed. Test with:"
echo "  busctl call $SERVICE /org/linux_wrapper_starter/Helper1 $SERVICE GetRootIdentity"
