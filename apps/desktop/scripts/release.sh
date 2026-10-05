#!/bin/bash

# Function to validate version number
validate_version() {
    if [[ ! $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "Error: Version must be in format x.y.z (e.g., 1.0.0)"
        exit 1
    fi
}

# Function to get current version from package.json
get_current_version() {
    node -p "require('./package.json').version"
}

# Function to increment version
increment_version() {
    local version=$1
    local increment_type=$2

    IFS='.' read -ra VERSION_PARTS <<< "$version"
    local major=${VERSION_PARTS[0]}
    local minor=${VERSION_PARTS[1]}
    local patch=${VERSION_PARTS[2]}

    case $increment_type in
        "major")
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        "minor")
            minor=$((minor + 1))
            patch=0
            ;;
        "patch")
            patch=$((patch + 1))
            ;;
    esac

    echo "${major}.${minor}.${patch}"
}

# Run type-check and ensure it succeeds
run_type_check() {
    echo "Running type check..."
    npm run type-check

    if [ $? -ne 0 ]; then
        echo "Error: Type check failed. Release aborted."
        exit 1
    fi

    echo "Type check passed. Proceeding with release..."
}

show_help() {
    cat <<'EOF'
Usage: npm run release [version|major|minor|patch] [options]

Options:
  major|minor|patch    Increment the given segment (default: patch)
  x.y.z                Release an explicit semantic version
  --draft              Mark the GitHub release as a draft
  --no-draft           Publish the GitHub release immediately (default)
  --prerelease         Mark the GitHub release as a pre-release (implies --draft)
  --stable             Ensure the release is marked as stable
  -h, --help           Show this help text

Examples:
  npm run release                      # bump patch, publish release
  npm run release minor -- --draft     # minor bump, create draft release
  npm run release 1.2.3 -- --prerelease
EOF
}

RELEASE_DRAFT=${RELEASE_DRAFT:-false}
RELEASE_PRERELEASE=${RELEASE_PRERELEASE:-false}
VERSION_ARG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        major|minor|patch)
            VERSION_ARG="$1"
            ;;
        --draft)
            RELEASE_DRAFT=true
            ;;
        --no-draft|--publish)
            RELEASE_DRAFT=false
            ;;
        --prerelease)
            RELEASE_PRERELEASE=true
            RELEASE_DRAFT=true
            ;;
        --stable)
            RELEASE_PRERELEASE=false
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            if [[ -z "$VERSION_ARG" && "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                VERSION_ARG="$1"
            else
                echo "Unknown argument: $1"
                show_help
                exit 1
            fi
            ;;
    esac
    shift
done

# Run type check first
run_type_check

# Get the current version
CURRENT_VERSION=$(get_current_version)
echo "Current version: $CURRENT_VERSION"

# Determine version increment type
if [[ "$VERSION_ARG" == "major" || "$VERSION_ARG" == "minor" || "$VERSION_ARG" == "patch" ]]; then
    NEW_VERSION=$(increment_version "$CURRENT_VERSION" "$VERSION_ARG")
elif [[ -n "$VERSION_ARG" ]]; then
    NEW_VERSION="$VERSION_ARG"
    validate_version "$NEW_VERSION"
else
    NEW_VERSION=$(increment_version "$CURRENT_VERSION" "patch")
fi

echo "New version will be: $NEW_VERSION"
echo "Draft release: $RELEASE_DRAFT"
echo "Prerelease: $RELEASE_PRERELEASE"

# Update version in package.json
npm version "$NEW_VERSION" --no-git-tag-version

# Stage versioned manifests together so the worktree stays clean after release
git add package.json package-lock.json

# Commit changes
git commit -m "chore: bump version to $NEW_VERSION"

TAG_MESSAGE=$'draft='${RELEASE_DRAFT}$'\nprerelease='${RELEASE_PRERELEASE}

# Create and push tag
git tag -a "v$NEW_VERSION" -m "$TAG_MESSAGE"
if ! git push origin main; then
    echo "Error: pushing main failed. Tag v$NEW_VERSION exists locally only; release aborted."
    exit 1
fi

# GitHub can reject a tag pushed right after its commit ("missing necessary objects"); retry once.
if ! git push origin "v$NEW_VERSION"; then
    echo "Tag push failed, retrying in 5s..."
    sleep 5
    if ! git push origin "v$NEW_VERSION"; then
        echo "Error: pushing tag v$NEW_VERSION failed. Retry with: git push origin v$NEW_VERSION"
        exit 1
    fi
fi

echo "Version $NEW_VERSION has been tagged and pushed!"
echo "Release metadata:"
echo "  draft=$RELEASE_DRAFT"
echo "  prerelease=$RELEASE_PRERELEASE"
echo "GitHub Actions will now build and publish the release."
