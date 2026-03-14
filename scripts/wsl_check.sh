#!/usr/bin/env bash
# wsl_check.sh
# Run this inside WSL. Checks for nvm, Node 20, and global packages.

echo "== WSL: Civitics Environment Quick Check =="

echo "Checking for nvm (~/.nvm)..."
if [ -d "$HOME/.nvm" ]; then
  echo " nvm directory found: $HOME/.nvm"
else
  echo " nvm not found. Install with: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
fi

echo "\nChecking Node..."
if command -v node >/dev/null 2>&1; then
  NV=$(node -v)
  echo " Node found: $NV"
  MAJOR=$(echo $NV | sed 's/v\([0-9]*\).*/\1/')
  if [ "$MAJOR" -eq 20 ]; then
    echo " Node version is 20.x — OK"
  else
    echo " Recommended: Node 20. Install with nvm: nvm install 20 && nvm use 20"
  fi
else
  echo " Node not found. Install via nvm: nvm install 20 && nvm use 20"
fi

echo "\nChecking global npm packages (@anthropic-ai/claude-code, turbo)..."
MISSING=0
for pkg in @anthropic-ai/claude-code turbo; do
  if npm list -g --depth=0 "$pkg" >/dev/null 2>&1; then
    V=$(npm list -g --depth=0 "$pkg" 2>/dev/null | grep "$pkg@" | head -n1 | sed 's/.*@//')
    echo " $pkg installed (version $V)"
  else
    echo " $pkg NOT installed globally. Install: npm install -g $pkg"
    MISSING=1
  fi
done

if [ $MISSING -eq 0 ]; then
  echo "\nAll recommended global packages present."
else
  echo "\nInstall missing global packages and re-run this script."
fi

echo "\nOptional: verify Docker inside WSL with 'docker version' if using local services."

echo "Done."
