# Proprietary and confidential. Unauthorized copying prohibited.

# Test script for Admin MCP Server

set -e

echo "================================"
echo "Admin MCP Server Test Script"
echo "================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Check Python version
echo "Test 1: Checking Python version..."
python_version=$(python --version 2>&1 | awk '{print $2}')
if [[ $(echo $python_version | cut -d. -f1) -ge 3 ]] && [[ $(echo $python_version | cut -d. -f2) -ge 10 ]]; then
    echo -e "${GREEN}✓${NC} Python version OK: $python_version"
else
    echo -e "${RED}✗${NC} Python version too old: $python_version (need 3.10+)"
    exit 1
fi
echo ""

# Test 2: Check dependencies
echo "Test 2: Checking dependencies..."
for dep in "mcp" "fastmcp" "prisma" "redis" "pymilvus" "dotenv" "httpx" "pydantic"; do
    if python -c "import $dep" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} $dep installed"
    else
        echo -e "${RED}✗${NC} $dep not installed - run: pip install -r requirements.txt"
        exit 1
    fi
done
echo ""

# Test 3: Check environment variables
echo "Test 3: Checking environment variables..."
required_vars=("DATABASE_URL" "REDIS_HOST" "MILVUS_HOST")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo -e "${YELLOW}⚠${NC} $var not set (using default or will fail at runtime)"
    else
        echo -e "${GREEN}✓${NC} $var is set"
    fi
done
echo ""

# Test 4: Check Prisma schema
echo "Test 4: Checking Prisma schema..."
if [ -f "schema.prisma" ]; then
    echo -e "${GREEN}✓${NC} Prisma schema found"
    echo "   Generating Prisma client..."
    if prisma generate 2>&1 | grep -q "Generated Prisma Client"; then
        echo -e "${GREEN}✓${NC} Prisma client generated successfully"
    else
        echo -e "${YELLOW}⚠${NC} Prisma generate may have issues"
    fi
else
    echo -e "${RED}✗${NC} Prisma schema not found"
    exit 1
fi
echo ""

# Test 5: Check file structure
echo "Test 5: Checking file structure..."
required_files=(
    "src/admin_mcp_server/__init__.py"
    "src/admin_mcp_server/server.py"
    "src/admin_mcp_server/user_tools.py"
    "src/admin_mcp_server/audit_tools.py"
)
for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓${NC} $file exists"
    else
        echo -e "${RED}✗${NC} $file not found"
        exit 1
    fi
done
echo ""

# Test 6: Syntax check
echo "Test 6: Checking Python syntax..."
for file in "${required_files[@]}"; do
    if python -m py_compile "$file" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} $file syntax OK"
    else
        echo -e "${RED}✗${NC} $file has syntax errors"
        exit 1
    fi
done
echo ""

# Test 7: Import test
echo "Test 7: Testing imports..."
if python -c "from admin_mcp_server import server; print('Import successful')" 2>&1 | grep -q "Import successful"; then
    echo -e "${GREEN}✓${NC} Server module imports successfully"
else
    echo -e "${RED}✗${NC} Server module import failed"
    exit 1
fi
echo ""

# Summary
echo "================================"
echo -e "${GREEN}All tests passed!${NC}"
echo "================================"
echo ""
echo "Next steps:"
echo "1. Set up environment variables in .env"
echo "2. Run: python -m admin_mcp_server.server"
echo "3. Or let MCP proxy start it automatically"
echo ""
echo "For testing with MCP proxy:"
echo "  curl -X POST http://mcp-proxy:8080/servers/admin/tools"
echo ""
