#!/usr/bin/env bash
set -euo pipefail

SERVICE="org.linux_wrapper_starter.Helper1"

echo "Removing helper (requires sudo)..."
sudo rm -f \
  /usr/libexec/linux-wrapper-helper \
  /usr/share/dbus-1/system-services/$SERVICE.service \
  /etc/dbus-1/system.d/$SERVICE.conf \
  /usr/share/polkit-1/actions/$SERVICE.policy

echo "Reloading D-Bus..."
if systemctl is-active --quiet dbus-broker; then
  sudo systemctl reload dbus-broker
else
  sudo systemctl reload dbus
fi

echo "Helper uninstalled."
