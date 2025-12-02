#!/bin/bash
# Neolit Integration
# Usage: ./integrate.sh /path/to/project

if [ -z "$1" ]; then
    echo "Usage: ./integrate.sh /path/to/project"
    exit 1
fi

PROJECT_DIR="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Copy neolit directory
mkdir -p "$PROJECT_DIR"
cp -r "$SCRIPT_DIR/neolit" "$PROJECT_DIR/"

# Copy config
cp "$SCRIPT_DIR/.neolitrc" "$PROJECT_DIR/"

echo "✓ Neolit integrated into $PROJECT_DIR"
echo ""
echo "Next: Run AI with 'neolit/prompts/ANALYZE_PROJECT.md' to document project"

cd "$PROJECT_DIR"
