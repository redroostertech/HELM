#!/bin/bash

###############################################################################
# HELM — Build & Release Script
#
# Packages the HELM terminal app for macOS, Windows, and Linux using
# Electron and electron-builder. Mirrors the lana-ai-client build strategy.
#
# Usage:
#   ./scripts/build-client.sh [OPTIONS]
#
# Options:
#   --platform <mac|win|linux|all>   Target platform (default: all)
#   --arch <x64|arm64|all>           Target architecture (default: all)
#   --skip-install                   Skip npm install
#   --clean                          Clean build directories before building
#   --publish                        Create GitHub release and upload artifacts
#   --skip-notarize                  Skip macOS notarization
#   --help                           Show this help message
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
# Examples:
#   # Build for all platforms
#   ./scripts/build-client.sh --platform all
#
#   # Build macOS ARM64 only
#   ./scripts/build-client.sh --platform mac --arch arm64
#
#   # Build all + publish to GitHub
#   ./scripts/build-client.sh --platform all --publish
#
#   # Skip notarization (faster for testing)
#   ./scripts/build-client.sh --platform mac --skip-notarize
#
###############################################################################

set -e  # Exit on error

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
PLATFORM="all"
ARCH="all"
SKIP_INSTALL=false
CLEAN=true  # Always clean for fresh builds
SKIP_NOTARIZE=false
PUBLISH_RELEASE=false

# Get version from package.json
VERSION=$(node -p "require('$PROJECT_ROOT/package.json').version")

###############################################################################
# Helper Functions
###############################################################################

print_header() {
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}  HELM v${VERSION} — Release Build${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}▶${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✖${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_info() {
    echo -e "${CYAN}ℹ${NC} $1"
}

show_help() {
    cat << EOF
Usage: ./scripts/build-client.sh [OPTIONS]

Build the HELM terminal app for macOS, Windows, and Linux.

OPTIONS:
    --platform <mac|win|linux|all>   Target platform (default: all)
    --arch <x64|arm64|all>           Target architecture (default: all)
    --skip-install                   Skip npm install
    --clean                          Clean build directories before building
    --publish                        Create GitHub release and upload artifacts
    --skip-notarize                  Skip macOS notarization
    --help                           Show this help message

EXAMPLES:
    Build for all platforms:
        ./scripts/build-client.sh --platform all

    Build for macOS ARM64 (Apple Silicon):
        ./scripts/build-client.sh --platform mac --arch arm64

    Build all + publish to GitHub:
        ./scripts/build-client.sh --platform all --publish

    Clean build and rebuild:
        ./scripts/build-client.sh --platform all --clean

OUTPUT:
    Built applications will be in: ./dist/

    Platform outputs:
      - macOS:   dist/macos-arm64/, dist/macos-x64/
      - Windows: dist/windows/
      - Linux:   dist/linux/

EOF
}

###############################################################################
# Parse Arguments
###############################################################################

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --platform)
                PLATFORM="$2"
                shift 2
                ;;
            --arch)
                ARCH="$2"
                shift 2
                ;;
            --skip-install)
                SKIP_INSTALL=true
                shift
                ;;
            --clean)
                CLEAN=true
                shift
                ;;
            --publish)
                PUBLISH_RELEASE=true
                shift
                ;;
            --skip-notarize)
                SKIP_NOTARIZE=true
                shift
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

###############################################################################
# Pre-flight Checks
###############################################################################

check_requirements() {
    print_step "Checking requirements..."

    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 18+ first."
        exit 1
    fi

    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js version 18+ is required. Current version: $(node -v)"
        exit 1
    fi

    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed. Please install npm first."
        exit 1
    fi

    print_success "Requirements check passed"
    print_info "Node.js: $(node -v)"
    print_info "npm: $(npm -v)"
}

###############################################################################
# Build Functions
###############################################################################

install_dependencies() {
    if [ "$SKIP_INSTALL" = true ]; then
        print_step "Skipping dependency installation (--skip-install flag)"
        return
    fi

    print_step "Installing dependencies..."
    cd "$PROJECT_ROOT"
    npm install
    print_success "Dependencies installed"
}

clean_build() {
    if [ "$CLEAN" = true ]; then
        print_step "Cleaning build directories and caches..."
        cd "$PROJECT_ROOT"

        # Clean build artifacts
        rm -rf dist/
        rm -rf release/
        rm -rf node_modules/.cache/
        print_success "Build directories cleaned"

        # Clear Electron app cache
        print_step "Clearing Electron app cache..."
        rm -rf ~/Library/Application\ Support/HELM 2>/dev/null || true
        rm -rf ~/Library/Caches/HELM 2>/dev/null || true
        print_success "Electron cache cleared"
    fi
}

build_app_code() {
    print_step "Building application code..."
    cd "$PROJECT_ROOT"

    print_info "Compiling TypeScript (main process)..."
    npm run build:electron
    print_success "TypeScript compiled"

    print_info "Building React (renderer)..."
    npm run build:react
    print_success "React built"
}

build_app() {
    print_step "Building application for platform: $PLATFORM, arch: $ARCH..."
    cd "$PROJECT_ROOT"

    export NODE_ENV=production

    # Build based on platform — each platform built separately to avoid conflicts
    case $PLATFORM in
        mac|darwin)
            if [ "$ARCH" = "arm64" ]; then
                print_info "Building for macOS ARM64 (Apple Silicon)..."
                npm run package:mac-arm64
            elif [ "$ARCH" = "x64" ]; then
                print_info "Building for macOS x64 (Intel)..."
                npm run package:mac-x64
            elif [ "$ARCH" = "all" ]; then
                print_info "Building for macOS (all architectures)..."
                npm run package:mac
            else
                # Detect current architecture
                if [[ $(uname -m) == "arm64" ]]; then
                    npm run package:mac-arm64
                else
                    npm run package:mac-x64
                fi
            fi
            ;;
        windows|win)
            print_info "Building for Windows x64..."
            npm run package:win
            ;;
        linux)
            print_info "Building for Linux (AppImage, deb)..."
            npm run package:linux
            ;;
        all)
            print_info "Building for ALL platforms (sequentially to avoid conflicts)..."
            print_info "Step 1/4: Building macOS ARM64..."
            npm run package:mac-arm64
            print_info "Step 2/4: Building macOS x64..."
            npm run package:mac-x64
            print_info "Step 3/4: Building Windows..."
            npm run package:win
            print_info "Step 4/4: Building Linux..."
            npm run package:linux
            ;;
        *)
            print_error "Unknown platform: $PLATFORM"
            exit 1
            ;;
    esac

    print_success "Build completed successfully!"
}

organize_output() {
    print_step "Organizing build outputs into platform directories..."

    DIST_DIR="$PROJECT_ROOT/dist"

    # Create platform directories
    mkdir -p "$DIST_DIR/macos-arm64"
    mkdir -p "$DIST_DIR/macos-x64"
    mkdir -p "$DIST_DIR/windows"
    mkdir -p "$DIST_DIR/linux"

    # Move macOS ARM64 files
    mv "$DIST_DIR/"*-arm64.dmg "$DIST_DIR/macos-arm64/" 2>/dev/null || true
    mv "$DIST_DIR/"*-arm64.zip "$DIST_DIR/macos-arm64/" 2>/dev/null || true

    # Move macOS x64 files
    mv "$DIST_DIR/"*-x64.dmg "$DIST_DIR/macos-x64/" 2>/dev/null || true
    mv "$DIST_DIR/"*-x64.zip "$DIST_DIR/macos-x64/" 2>/dev/null || true

    # Move Windows files
    mv "$DIST_DIR/"*.exe "$DIST_DIR/windows/" 2>/dev/null || true
    mv "$DIST_DIR/"*win*.zip "$DIST_DIR/windows/" 2>/dev/null || true

    # Move Linux files
    mv "$DIST_DIR/"*.AppImage "$DIST_DIR/linux/" 2>/dev/null || true
    mv "$DIST_DIR/"*.deb "$DIST_DIR/linux/" 2>/dev/null || true
    mv "$DIST_DIR/"*.rpm "$DIST_DIR/linux/" 2>/dev/null || true

    # Clean up empty directories
    rmdir "$DIST_DIR/macos-arm64" 2>/dev/null || true
    rmdir "$DIST_DIR/macos-x64" 2>/dev/null || true
    rmdir "$DIST_DIR/windows" 2>/dev/null || true
    rmdir "$DIST_DIR/linux" 2>/dev/null || true

    print_success "Outputs organized into platform directories"
}

show_output() {
    echo ""
    print_step "Build output location:"
    echo ""
    echo -e "  ${GREEN}Distribution files:${NC} $PROJECT_ROOT/dist/"
    echo ""

    if [ -d "$PROJECT_ROOT/dist" ]; then
        print_step "Generated files (organized by platform):"
        echo ""

        # List macOS ARM64 files (Apple Silicon)
        if [ -d "$PROJECT_ROOT/dist/macos-arm64" ] && [ "$(ls -A "$PROJECT_ROOT/dist/macos-arm64" 2>/dev/null)" ]; then
            echo -e "  ${CYAN}📁 macos-arm64/${NC} (Apple Silicon Macs)"
            for file in "$PROJECT_ROOT/dist/macos-arm64/"*; do
                [ -f "$file" ] && echo -e "      $(basename "$file") ($(du -h "$file" | cut -f1))"
            done
            echo ""
        fi

        # List macOS x64 files (Intel)
        if [ -d "$PROJECT_ROOT/dist/macos-x64" ] && [ "$(ls -A "$PROJECT_ROOT/dist/macos-x64" 2>/dev/null)" ]; then
            echo -e "  ${CYAN}📁 macos-x64/${NC} (Intel Macs)"
            for file in "$PROJECT_ROOT/dist/macos-x64/"*; do
                [ -f "$file" ] && echo -e "      $(basename "$file") ($(du -h "$file" | cut -f1))"
            done
            echo ""
        fi

        # List Windows files
        if [ -d "$PROJECT_ROOT/dist/windows" ] && [ "$(ls -A "$PROJECT_ROOT/dist/windows" 2>/dev/null)" ]; then
            echo -e "  ${CYAN}📁 windows/${NC} (Windows PCs)"
            for file in "$PROJECT_ROOT/dist/windows/"*; do
                [ -f "$file" ] && echo -e "      $(basename "$file") ($(du -h "$file" | cut -f1))"
            done
            echo ""
        fi

        # List Linux files
        if [ -d "$PROJECT_ROOT/dist/linux" ] && [ "$(ls -A "$PROJECT_ROOT/dist/linux" 2>/dev/null)" ]; then
            echo -e "  ${CYAN}📁 linux/${NC} (Linux PCs)"
            for file in "$PROJECT_ROOT/dist/linux/"*; do
                [ -f "$file" ] && echo -e "      $(basename "$file") ($(du -h "$file" | cut -f1))"
            done
            echo ""
        fi
    fi
}

show_summary() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}  Build Summary${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
    echo -e "  ${CYAN}Platform:${NC}     $PLATFORM"
    echo -e "  ${CYAN}Architecture:${NC} $ARCH"
    echo -e "  ${CYAN}Output:${NC}       $PROJECT_ROOT/dist/"
    echo ""

    print_success "HELM v${VERSION} build process completed!"
    echo ""
    echo -e "${BLUE}Distribution Instructions:${NC}"
    echo ""
    echo "  Each platform folder contains the files to send to users:"
    echo ""
    echo "  📁 dist/macos-arm64/  → For Apple Silicon Macs (M1/M2/M3)"
    echo "       Send: HELM-${VERSION}-arm64.dmg"
    echo ""
    echo "  📁 dist/macos-x64/    → For Intel Macs"
    echo "       Send: HELM-${VERSION}-x64.dmg"
    echo ""
    echo "  📁 dist/windows/      → For Windows PCs"
    echo "       Send: HELM-${VERSION}-setup.exe"
    echo ""
    echo "  📁 dist/linux/        → For Linux PCs"
    echo "       Send: HELM-${VERSION}.AppImage (universal)"
    echo "       Or:   HELM-${VERSION}.deb (Debian/Ubuntu)"
    echo ""
}

###############################################################################
# GitHub Release
###############################################################################

create_github_release() {
    if [ "$PUBLISH_RELEASE" = false ]; then
        return
    fi

    print_step "Creating GitHub release v${VERSION}..."

    # Check if gh CLI is installed
    if ! command -v gh &> /dev/null; then
        print_error "GitHub CLI (gh) is not installed. Please install it first."
        print_info "Install with: brew install gh"
        return 1
    fi

    # Check if authenticated
    if ! gh auth status &> /dev/null; then
        print_error "GitHub CLI is not authenticated. Please run: gh auth login"
        return 1
    fi

    DIST_DIR="$PROJECT_ROOT/dist"
    RELEASE_TAG="v${VERSION}"

    # -------------------------------------------------------------------------
    # Step 1: Create and push git tag if it doesn't exist
    # -------------------------------------------------------------------------
    if git rev-parse "${RELEASE_TAG}" &>/dev/null; then
        print_info "Git tag ${RELEASE_TAG} already exists"
    else
        print_info "Creating git tag ${RELEASE_TAG}..."
        git tag "${RELEASE_TAG}"
    fi
    # Always ensure tag is pushed to remote
    git push origin "${RELEASE_TAG}" 2>/dev/null || true
    print_success "Git tag ${RELEASE_TAG} pushed to remote"

    # -------------------------------------------------------------------------
    # Step 2: Generate release notes from git history
    # -------------------------------------------------------------------------
    print_info "Generating release notes..."

    # Find the previous tag
    PREV_TAG=$(git tag --sort=-v:refname | grep -v "^${RELEASE_TAG}$" | grep -v "pre-release" | head -1)

    RELEASE_NOTES="## HELM ${RELEASE_TAG} — Release Notes"$'\n\n'

    if [ -n "$PREV_TAG" ]; then
        print_info "Generating changelog from ${PREV_TAG} to ${RELEASE_TAG}..."
        COMMIT_RANGE="${PREV_TAG}..${RELEASE_TAG}"

        # Collect features
        FEATURES=$(git log "$COMMIT_RANGE" --pretty=format:"%s|%h" --no-merges | grep -i "^feat\|^Add\|^add" | while IFS='|' read -r msg hash; do
            clean_msg=$(echo "$msg" | sed -E 's/^(feat|Add|add)(\([^)]*\))?:\s*//')
            echo "- ${clean_msg} (\`${hash}\`)"
        done)

        # Collect bug fixes
        FIXES=$(git log "$COMMIT_RANGE" --pretty=format:"%s|%h" --no-merges | grep -i "^fix\|^Fix" | while IFS='|' read -r msg hash; do
            clean_msg=$(echo "$msg" | sed -E 's/^(fix|Fix)(\([^)]*\))?:\s*//')
            echo "- ${clean_msg} (\`${hash}\`)"
        done)

        # Collect other notable commits
        OTHER=$(git log "$COMMIT_RANGE" --pretty=format:"%s|%h" --no-merges | grep -iv "^feat\|^fix\|^chore\|^debug\|^test\|^Bump\|^Merge\|^Add\|^add\|^Fix" | while IFS='|' read -r msg hash; do
            echo "- ${msg} (\`${hash}\`)"
        done)

        if [ -n "$FEATURES" ]; then
            RELEASE_NOTES+="### Features"$'\n\n'"${FEATURES}"$'\n\n'
        fi

        if [ -n "$FIXES" ]; then
            RELEASE_NOTES+="### Bug Fixes"$'\n\n'"${FIXES}"$'\n\n'
        fi

        if [ -n "$OTHER" ]; then
            RELEASE_NOTES+="### Other Changes"$'\n\n'"${OTHER}"$'\n\n'
        fi

        RELEASE_NOTES+="---"$'\n'"**Full Changelog**: ${PREV_TAG}...${RELEASE_TAG}"
    else
        print_warning "No previous tag found, using generic notes"
        RELEASE_NOTES+="Initial release."
    fi

    # -------------------------------------------------------------------------
    # Step 3: Create draft release with generated notes
    # -------------------------------------------------------------------------
    print_info "Creating draft release ${RELEASE_TAG}..."
    if gh release view "${RELEASE_TAG}" &>/dev/null; then
        print_info "Release ${RELEASE_TAG} already exists, updating notes..."
        echo "$RELEASE_NOTES" | gh release edit "${RELEASE_TAG}" --notes-file - 2>/dev/null || true
    else
        echo "$RELEASE_NOTES" | gh release create "${RELEASE_TAG}" \
            --title "HELM ${RELEASE_TAG}" \
            --notes-file - \
            --draft
        if [ $? -ne 0 ]; then
            print_error "Failed to create GitHub release ${RELEASE_TAG}"
            return 1
        fi
        print_success "Draft release ${RELEASE_TAG} created"
    fi

    # -------------------------------------------------------------------------
    # Step 4: Upload build artifacts
    # -------------------------------------------------------------------------
    print_step "Uploading build artifacts..."

    # Upload macOS ARM64 files
    if [ -d "$DIST_DIR/macos-arm64" ]; then
        for file in "$DIST_DIR/macos-arm64/"*.dmg "$DIST_DIR/macos-arm64/"*.zip; do
            [ -f "$file" ] && {
                print_info "Uploading $(basename "$file")..."
                gh release upload "${RELEASE_TAG}" "$file" --clobber
            }
        done
    fi

    # Upload macOS x64 files
    if [ -d "$DIST_DIR/macos-x64" ]; then
        for file in "$DIST_DIR/macos-x64/"*.dmg "$DIST_DIR/macos-x64/"*.zip; do
            [ -f "$file" ] && {
                print_info "Uploading $(basename "$file")..."
                gh release upload "${RELEASE_TAG}" "$file" --clobber
            }
        done
    fi

    # Upload Windows files
    if [ -d "$DIST_DIR/windows" ]; then
        for file in "$DIST_DIR/windows/"*.exe; do
            [ -f "$file" ] && {
                print_info "Uploading $(basename "$file")..."
                gh release upload "${RELEASE_TAG}" "$file" --clobber
            }
        done
    fi

    # Upload Linux files
    if [ -d "$DIST_DIR/linux" ]; then
        for file in "$DIST_DIR/linux/"*.AppImage "$DIST_DIR/linux/"*.deb "$DIST_DIR/linux/"*.rpm; do
            [ -f "$file" ] && {
                print_info "Uploading $(basename "$file")..."
                gh release upload "${RELEASE_TAG}" "$file" --clobber
            }
        done
    fi

    # Upload update manifests
    for file in "$DIST_DIR/"latest*.yml; do
        [ -f "$file" ] && {
            print_info "Uploading $(basename "$file")..."
            gh release upload "${RELEASE_TAG}" "$file" --clobber
        }
    done

    # -------------------------------------------------------------------------
    # Step 5: Publish the release (remove draft status)
    # -------------------------------------------------------------------------
    print_info "Publishing release ${RELEASE_TAG}..."
    gh release edit "${RELEASE_TAG}" --draft=false

    print_success "GitHub release ${RELEASE_TAG} published with release notes and artifacts!"
    echo ""
    echo -e "  ${GREEN}Release URL:${NC} https://github.com/redroostertech/HELM/releases/tag/${RELEASE_TAG}"
    echo ""
}

###############################################################################
# Main Execution
###############################################################################

main() {
    print_header

    # Parse command line arguments
    parse_args "$@"

    # Apple Developer credentials for signing and notarization
    if [ "$SKIP_NOTARIZE" = true ]; then
        print_warning "Skipping macOS notarization (--skip-notarize)"
        export CSC_IDENTITY_AUTO_DISCOVERY=false
    else
        if [ -z "$APPLE_TEAM_ID" ]; then
            echo -e "${YELLOW}Apple Developer credentials required for signing/notarization${NC}"
            echo ""
            read -p "Enter APPLE_TEAM_ID (from developer.apple.com): " APPLE_TEAM_ID
            export APPLE_TEAM_ID
        fi

        if [ -z "$APPLE_ID" ]; then
            read -p "Enter APPLE_ID (your Apple ID email): " APPLE_ID
            export APPLE_ID
        fi

        if [ -z "$APPLE_APP_SPECIFIC_PASSWORD" ]; then
            echo "Enter APPLE_APP_SPECIFIC_PASSWORD (generate at appleid.apple.com > App-Specific Passwords):"
            read -s APPLE_APP_SPECIFIC_PASSWORD
            echo ""
            export APPLE_APP_SPECIFIC_PASSWORD
        fi

        print_success "Apple credentials configured"
    fi

    # Display configuration
    echo -e "${CYAN}Configuration:${NC}"
    echo -e "  Platform:     $PLATFORM"
    echo -e "  Architecture: $ARCH"
    echo -e "  Publish:      $PUBLISH_RELEASE"
    echo -e "  Notarize:     $([ "$SKIP_NOTARIZE" = true ] && echo 'no' || echo 'yes')"
    echo ""

    # Run build steps
    check_requirements
    clean_build
    install_dependencies
    build_app_code
    build_app
    organize_output
    show_output
    show_summary
    create_github_release
}

# Run main function
main "$@"
