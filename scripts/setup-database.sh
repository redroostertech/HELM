#!/bin/bash

# Tuttle PostgreSQL Database Setup Script

set -e

echo "🔧 Tuttle Database Setup"
echo "========================"
echo ""

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL is not installed or not in PATH"
    echo "Install PostgreSQL: brew install postgresql@16"
    exit 1
fi

echo "✅ PostgreSQL found"

# Get database name (default: tuttle)
DB_NAME="${PGDATABASE:-tuttle}"
DB_USER="${PGUSER:-$USER}"

echo ""
echo "Database name: $DB_NAME"
echo "Database user: $DB_USER"
echo ""

# Check if database exists
if psql -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    echo "⚠️  Database '$DB_NAME' already exists"
    read -p "Do you want to drop and recreate it? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🗑️  Dropping database '$DB_NAME'..."
        dropdb "$DB_NAME" || true
    else
        echo "✅ Using existing database"
        exit 0
    fi
fi

# Create database
echo "📦 Creating database '$DB_NAME'..."
createdb "$DB_NAME"

echo ""
echo "✅ Database setup complete!"
echo ""
echo "Next steps:"
echo "1. (Optional) Copy .env.example to .env and configure if needed"
echo "2. Run: npm run dev"
echo ""
echo "The app will automatically create tables on first run."
