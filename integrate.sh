#!/bin/bash
# Neolit Integration
# Usage: ./integrate.sh /path/to/project

PROJECT_DIR="${1:-.}"
NEOLIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$PROJECT_DIR"/{.neolit/adr,src,prompts,templates/src/module}
cd "$PROJECT_DIR"

# Copy templates
cp "$NEOLIT_DIR/templates/AGENTS.md" ./
cp "$NEOLIT_DIR/templates/HUMAN.org" ./
cp -r "$NEOLIT_DIR/templates/.neolit/"* .neolit/
cp -r "$NEOLIT_DIR/templates/src/module/"* templates/src/module/
cp "$NEOLIT_DIR/prompts/"* prompts/

echo "✓ Neolit integrated into: $(pwd)"
echo ""
echo "Next:"
echo "1. Read INTEGRATION.md for workflow"
echo "2. Run agent with: prompts/ANALYZE_PROJECT.md"
echo "   to populate .neolit/ with project-specific docs"

cd "$PROJECT_DIR"
