#!/bin/bash
# release.sh — bump version, push, publish to npm
# Usage: ./release.sh [patch|minor|major]
# Default: patch

set -e

TYPE=${1:-patch}

if [[ "$TYPE" != "patch" && "$TYPE" != "minor" && "$TYPE" != "major" ]]; then
  echo "Usage: ./release.sh [patch|minor|major]"
  exit 1
fi

echo "🔖 Bumping $TYPE version..."
npm version $TYPE -m "release: v%s"

echo "📤 Pushing to GitHub..."
git push origin main --tags

echo "📦 Publishing to npm..."
npm publish

echo ""
echo "✅ Released! Version: $(node -p "require('./package.json').version")"
echo "🔗 https://www.npmjs.com/package/knight-os"
