# Proprietary and confidential. Unauthorized copying prohibited.

# =============================================================================
# K3s Kubelet Secret Cache Permanent Fix
# =============================================================================
#
# This script fixes the kubelet secret cache issue where secrets exist in the
# API server but kubelet can't fetch them due to a stale watcher cache.
#
# Root Cause:
#   - Kubelet's default configMapAndSecretChangeDetectionStrategy is "Watch"
#   - When secrets become idle for >5 minutes, the watcher stops
#   - When a new pod references the secret, the reflector restarts with a
#     1-second timeout and fails due to resource version mismatch
#
# Solution:
#   - Change configMapAndSecretChangeDetectionStrategy to "Get"
#   - This fetches secrets directly from the API server, bypassing the cache
#
# References:
#   - https://github.com/kubernetes/kubernetes/issues/117972
#   - https://docs.k3s.io/installation/configuration
#
# Usage:
#   Run this script on each k3s worker node with sudo:
#   $ sudo ./fix-k3s-secret-cache.sh
#
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}K3s Kubelet Secret Cache Fix${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}ERROR: This script must be run as root (use sudo)${NC}"
    exit 1
fi

# Detect if this is a k3s server or agent
if systemctl is-active --quiet k3s; then
    K3S_SERVICE="k3s"
    echo -e "${YELLOW}Detected: k3s server${NC}"
elif systemctl is-active --quiet k3s-agent; then
    K3S_SERVICE="k3s-agent"
    echo -e "${YELLOW}Detected: k3s agent${NC}"
else
    echo -e "${RED}ERROR: No k3s or k3s-agent service found running${NC}"
    exit 1
fi

# Create directories if they don't exist
echo "Creating configuration directories..."
mkdir -p /etc/rancher/k3s
mkdir -p /var/lib/rancher/k3s/agent/etc/kubelet.conf.d

# Create kubelet configuration file
KUBELET_CONFIG="/etc/rancher/k3s/kubelet-secret-fix.yaml"
echo "Creating kubelet configuration at $KUBELET_CONFIG..."
cat > "$KUBELET_CONFIG" << 'EOF'
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
# Change from "Watch" (default) to "Get" to fetch secrets directly from API server
# This bypasses the watcher cache that can become stale
configMapAndSecretChangeDetectionStrategy: Get
EOF

echo -e "${GREEN}✓ Created kubelet configuration${NC}"

# Update k3s config.yaml to reference the kubelet config
K3S_CONFIG="/etc/rancher/k3s/config.yaml"
KUBELET_ARG="kubelet-arg: \"config=$KUBELET_CONFIG\""

if [ -f "$K3S_CONFIG" ]; then
    # Check if kubelet-arg is already set
    if grep -q "kubelet-arg:" "$K3S_CONFIG"; then
        # Check if our specific config is already there
        if grep -q "$KUBELET_CONFIG" "$K3S_CONFIG"; then
            echo -e "${YELLOW}⚠ Kubelet config already referenced in $K3S_CONFIG${NC}"
        else
            echo -e "${YELLOW}⚠ Existing kubelet-arg found. Adding our config...${NC}"
            # Append our config to existing kubelet-arg section
            sed -i "/kubelet-arg:/a\  - \"config=$KUBELET_CONFIG\"" "$K3S_CONFIG"
        fi
    else
        echo "Adding kubelet-arg to existing config..."
        echo "" >> "$K3S_CONFIG"
        echo "# Kubelet secret cache fix - added by fix-k3s-secret-cache.sh" >> "$K3S_CONFIG"
        echo "kubelet-arg:" >> "$K3S_CONFIG"
        echo "  - \"config=$KUBELET_CONFIG\"" >> "$K3S_CONFIG"
    fi
else
    echo "Creating new k3s config..."
    cat > "$K3S_CONFIG" << EOF
# K3s configuration
# Added by fix-k3s-secret-cache.sh

# Reference kubelet configuration file for secret cache fix
kubelet-arg:
  - "config=$KUBELET_CONFIG"
EOF
fi

echo -e "${GREEN}✓ Updated k3s configuration${NC}"

# Show the resulting config
echo ""
echo "Current k3s config:"
echo "---"
cat "$K3S_CONFIG"
echo "---"
echo ""

# Restart k3s service to apply changes
echo -e "${YELLOW}Restarting $K3S_SERVICE service to apply changes...${NC}"
systemctl restart "$K3S_SERVICE"

# Wait for service to come back up
echo "Waiting for $K3S_SERVICE to start..."
sleep 5

if systemctl is-active --quiet "$K3S_SERVICE"; then
    echo -e "${GREEN}✓ $K3S_SERVICE service restarted successfully${NC}"
else
    echo -e "${RED}ERROR: $K3S_SERVICE failed to start. Check logs with:${NC}"
    echo "  journalctl -u $K3S_SERVICE -n 50"
    exit 1
fi

# Verify the configuration was applied
echo ""
echo "Verifying kubelet configuration..."
sleep 3

# Try to get the kubelet config via the API
NODE_NAME=$(hostname)
echo "Checking kubelet config for node: $NODE_NAME"

# The verification would need kubectl, which may not be on agent nodes
if command -v kubectl &> /dev/null; then
    STRATEGY=$(kubectl get --raw /api/v1/nodes/$NODE_NAME/proxy/configz 2>/dev/null | grep -o '"configMapAndSecretChangeDetectionStrategy":"[^"]*"' | cut -d'"' -f4)
    if [ "$STRATEGY" == "Get" ]; then
        echo -e "${GREEN}✓ Verified: configMapAndSecretChangeDetectionStrategy is now 'Get'${NC}"
    else
        echo -e "${YELLOW}⚠ Could not verify kubelet config (current: $STRATEGY)${NC}"
        echo "  The change may take a moment to propagate."
    fi
else
    echo -e "${YELLOW}⚠ kubectl not available on this node to verify configuration${NC}"
    echo "  Run on a node with kubectl access:"
    echo "  kubectl get --raw /api/v1/nodes/$NODE_NAME/proxy/configz | jq '.kubeletconfig.configMapAndSecretChangeDetectionStrategy'"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Fix Applied Successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "The kubelet will now fetch secrets directly from the API server"
echo "instead of using the watcher cache. This prevents the 'secret not found'"
echo "errors caused by stale cache."
echo ""
echo "Next steps:"
echo "  1. Run this script on all other k3s worker nodes"
echo "  2. Delete and recreate any pods that are stuck in ContainerCreating"
echo ""
