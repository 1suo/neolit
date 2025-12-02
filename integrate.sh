#!/bin/bash
# Neolit Integration
# Usage: ./integrate.sh /path/to/project

PROJECT_DIR="${1:-.}"
NEOLIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$PROJECT_DIR"/{docs/adr,src,prompts,templates/src/module}
cd "$PROJECT_DIR"

# Copy templates
cp "$NEOLIT_DIR/templates/AGENTS.md" ./
cp "$NEOLIT_DIR/templates/SYSTEM.org" ./
cp -r "$NEOLIT_DIR/templates/docs/"* docs/
cp -r "$NEOLIT_DIR/templates/src/module/"* templates/src/module/
cp "$NEOLIT_DIR/prompts/"* prompts/

echo "✓ Neolit integrated into: $(pwd)"
echo ""
echo "Next:"
echo "1. Read AGENTS.md"
echo "2. Document foundations (schema, ADRs, workflows)"
echo "3. Create module: see prompts/CREATE-MODULE.md"
