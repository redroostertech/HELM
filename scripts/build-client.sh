#!/bin/bash
# =============================================================================
# HELM — Build & Release Script
# Builds the app for macOS, Windows, and Linux, then publishes to GitHub.
#
# Usage:
#   ./scripts/build-release.sh [options]
#
# Options:
#   --platform <mac|win|linux|all>   Target platform (default: mac)
#   --arch <x64|arm64|all>           Target architecture (default: all)
#   --clean                          Clean build dirs before building
#   --publish                        Create GitHub release and upload artifacts
#   --draft                          Create release as draft (use with --publish)
#   --skip-install                   Skip npm install
#   --skip-notarize                  Skip macOS notarization
#   --help                           Show this help
#
# Environment variables for macOS notarization:
#   APPLE_TEAM_ID                    Apple Developer Team ID
#   APPLE_ID                         Apple ID email
#   APPLE_APP_SPECIFIC_PASSWORD      App-specific password
#
# Environment variables for Windows code signing:
#   WIN_CSC_LINK                     Path to .pfx certificate
#   WIN_CSC_KEY_PASSWORD             Certificate password
#
# Requires: node 18+, npm, gh (GitHub CLI for --publish)
# =============================================================================

set -e

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

info()    { echo -e "${BLUE}ℹ${NC}  $1"; }
success() { echo -e "${GREEN}✅${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠️${NC}  $1"; }
error()   { echo -e "${RED}❌${NC} $1"; exit 1; }
step()    { echo -e "\n${CYAN}${BOLD}▸ $1${NC}"; }

# --- Defaults ---
PLATFORM="mac"
ARCH="all"
CLEAN=false
PUBLISH=false
DRAFT=false
SKIP_INSTALL=false
SKIP_NOTARIZE=false

# --- Parse args ---
while [[ $# -gt 0 ]]; do
    case $1 in
        --platform)   PLATFORM="$2"; shift 2 ;;
        --arch)       ARCH="$2"; shift 2 ;;
        --clean)      CLEAN=true; shift ;;
        --publish)    PUBLISH=true; shift ;;
        --draft)      DRAFT=true; shift ;;
        --skip-install)    SKIP_INSTALL=true; shift ;;
        --skip-notarize)   SKIP_NOTARIZE=true; shift ;;
        --help)
            head -30 "$0" | grep -E "^#" | sed 's/^# \?//'
            exit 0
            ;;
        *) error "Unknown option: $1" ;;
    esac
done

# --- Navigate to project root ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# --- Read version from package.json ---
VERSION=$(node -p "require('./package.json').version")
PRODUCT_NAME=$(node -p "require('./package.json').build.productName")

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  ${PRODUCT_NAME} v${VERSION} — Release Build${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
echo ""
info "Platform:  ${PLATFORM}"
info "Arch:      ${ARCH}"
info "Publish:   ${PUBLISH}"
info "Clean:     ${CLEAN}"
echo ""

# --- Pre-flight checks ---
step "Pre-flight checks"

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    error "Node.js 18+ required. Current: $(node -v)"
fi
success "Node.js $(node -v)"

if ! command -v npm &> /dev/null; then
    error "npm not found"
fi
success "npm $(npm -v)"

if [ "$PUBLISH" = true ]; then
    if ! command -v gh &> /dev/null; then
        error "GitHub CLI (gh) required for --publish. Install: brew install gh"
    fi
    if ! gh auth status &> /dev/null; then
        error "GitHub CLI not authenticated. Run: gh auth login"
    fi
    success "GitHub CLI authenticated"
fi

# --- macOS notarization credentials ---
if [ "$PLATFORM" = "mac" ] || [ "$PLATFORM" = "all" ]; then
    if [ "$SKIP_NOTARIZE" = false ]; then
        if [ -z "$APPLE_TEAM_ID" ]; then
            read -p "$(echo -e ${YELLOW})Apple Team ID: $(echo -e ${NC})" APPLE_TEAM_ID
            export APPLE_TEAM_ID
        fi
        if [ -z "$APPLE_ID" ]; then
            read -p "$(echo -e ${YELLOW})Apple ID (email): $(echo -e ${NC})" APPLE_ID
            export APPLE_ID
        fi
        if [ -z "$APPLE_APP_SPECIFIC_PASSWORD" ]; then
            read -sp "$(echo -e ${YELLOW})App-specific password: $(echo -e ${NC})" APPLE_APP_SPECIFIC_PASSWORD
            echo ""
            export APPLE_APP_SPECIFIC_PASSWORD
        fi
        success "macOS notarization credentials set"
    else
        warn "Skipping macOS notarization"
    fi
fi

# --- Clean ---
if [ "$CLEAN" = true ]; then
    step "Cleaning build directories"
    rm -rf dist/
    rm -rf release/
    success "Cleaned dist/ and release/"
fi

# --- Install dependencies ---
if [ "$SKIP_INSTALL" = false ]; then
    step "Installing dependencies"
    npm install
    success "Dependencies installed"
else
    info "Skipping npm install"
fi

# --- Build app ---
step "Building application"

info "Compiling TypeScript (main process)..."
npm run build:electron
success "TypeScript compiled"

info "Building React (renderer)..."
npm run build:react
success "React built"

# --- Package ---
step "Packaging for ${PLATFORM} (${ARCH})"

BUILD_ARGS=""

# Platform flags
case $PLATFORM in
    mac)
        case $ARCH in
            arm64) BUILD_ARGS="--mac --arm64" ;;
            x64)   BUILD_ARGS="--mac --x64" ;;
            all)   BUILD_ARGS="--mac" ;;
            *)     error "Invalid arch: $ARCH" ;;
        esac
        ;;
    win)
        BUILD_ARGS="--win"
        ;;
    linux)
        BUILD_ARGS="--linux"
        ;;
    all)
        BUILD_ARGS="--mac --win --linux"
        ;;
    *)
        error "Invalid platform: $PLATFORM"
        ;;
esac

# Patch notarize config in package.json before building
PATCHED_PKG=false
if [ "$PLATFORM" = "mac" ] || [ "$PLATFORM" = "all" ]; then
    if [ "$SKIP_NOTARIZE" = true ]; then
        export CSC_IDENTITY_AUTO_DISCOVERY=false
        node -e "
          const pkg = require('./package.json');
          pkg.build.mac.notarize = false;
          require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
        "
    else
        # Inject teamId into notarize config (required by @electron/notarize 2.x)
        node -e "
          const pkg = require('./package.json');
          pkg.build.mac.notarize = { teamId: process.env.APPLE_TEAM_ID || '' };
          require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
        "
    fi
    PATCHED_PKG=true
fi

info "Running: electron-builder ${BUILD_ARGS}"
npx electron-builder $BUILD_ARGS

# Restore package.json notarize setting
if [ "$PATCHED_PKG" = true ]; then
    node -e "
      const pkg = require('./package.json');
      pkg.build.mac.notarize = true;
      require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    "
fi

success "Packaging complete"

# --- Organize output ---
step "Organizing build artifacts"

RELEASE_DIR="$PROJECT_ROOT/release/v${VERSION}"
mkdir -p "$RELEASE_DIR"

# Move artifacts to release directory
find dist/ -maxdepth 1 \( \
    -name "*.dmg" -o \
    -name "*.zip" -o \
    -name "*.exe" -o \
    -name "*.AppImage" -o \
    -name "*.deb" -o \
    -name "*.rpm" -o \
    -name "*.yml" -o \
    -name "*.yaml" \
\) -exec cp {} "$RELEASE_DIR/" \;

echo ""
info "Artifacts in ${RELEASE_DIR}:"
ls -lh "$RELEASE_DIR/" 2>/dev/null | grep -v total | awk '{print "  " $NF " (" $5 ")"}'

# --- Publish to GitHub ---
if [ "$PUBLISH" = true ]; then
    step "Publishing to GitHub"

    TAG="v${VERSION}"

    # Check if tag already exists
    if git rev-parse "$TAG" &> /dev/null; then
        warn "Tag ${TAG} already exists. Deleting and recreating..."
        git tag -d "$TAG" 2>/dev/null || true
        git push origin ":refs/tags/${TAG}" 2>/dev/null || true
    fi

    # Create tag
    git tag -a "$TAG" -m "Release ${TAG}"
    git push origin "$TAG"
    success "Tag ${TAG} created and pushed"

    # Generate release notes from git log
    PREV_TAG=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
    if [ -n "$PREV_TAG" ]; then
        NOTES=$(git log --pretty=format:"- %s" "${PREV_TAG}..HEAD" | head -30)
    else
        NOTES=$(git log --pretty=format:"- %s" --max-count=20)
    fi

    RELEASE_BODY="## HELM ${TAG}

### What's New
${NOTES}

### Downloads
- **macOS (Apple Silicon):** \`HELM-${VERSION}-arm64.dmg\`
- **macOS (Intel):** \`HELM-${VERSION}-x64.dmg\`
- **Windows:** \`HELM-${VERSION}-setup.exe\`
- **Linux:** \`HELM-${VERSION}.AppImage\`

---
*Powered by LANA AI — RedRooster Technologies Inc.*"

    # Create GitHub release
    DRAFT_FLAG=""
    if [ "$DRAFT" = true ]; then
        DRAFT_FLAG="--draft"
    fi

    info "Creating GitHub release..."
    gh release create "$TAG" \
        --title "HELM ${TAG}" \
        --notes "$RELEASE_BODY" \
        $DRAFT_FLAG \
        "$RELEASE_DIR"/*

    success "GitHub release created: ${TAG}"

    # Print release URL
    RELEASE_URL=$(gh release view "$TAG" --json url -q .url 2>/dev/null || echo "")
    if [ -n "$RELEASE_URL" ]; then
        echo ""
        info "Release URL: ${RELEASE_URL}"
    fi
fi

# --- Done ---
echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ${PRODUCT_NAME} v${VERSION} — Build Complete!${NC}"
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Artifacts: ${CYAN}${RELEASE_DIR}${NC}"
if [ "$PUBLISH" = true ]; then
    echo -e "  Release:   ${CYAN}${RELEASE_URL:-https://github.com/redroostertech/HELM/releases}${NC}"
fi
echo ""
