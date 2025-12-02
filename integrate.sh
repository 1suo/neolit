#!/bin/bash
# Neolit Integration
# Usage: ./integrate.sh /path/to/project

PROJECT_DIR="${1:-.}"
NEOLIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$PROJECT_DIR"/{.neolit/adr,src,prompts,templates/src/module}
cd "$PROJECT_DIR"

# Copy templates
cp "$NEOLIT_DIR/templates/AGENTS.md" ./
cp "$NEOLIT_DIR/templates/SYSTEM.org" ./
cp -r "$NEOLIT_DIR/templates/.neolit/"* .neolit/
cp -r "$NEOLIT_DIR/templates/src/module/"* templates/src/module/
cp "$NEOLIT_DIR/prompts/"* prompts/

echo "✓ Neolit integrated into: $(pwd)"
echo ""
echo "Next:"
echo "1. Read AGENTS.md"
echo "2. Document foundations: .neolit/system.md (see prompts/ANALYZE-EXISTING.md)"
echo "3. Create module: see prompts/FEATURE.md"
