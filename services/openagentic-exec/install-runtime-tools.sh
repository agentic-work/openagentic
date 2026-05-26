

# =============================================================================
# RUNTIME TOOLS INSTALLER
# =============================================================================
# Installs infrastructure/DevOps tools on first pod boot, caches them to
# /opt/tools so subsequent boots are instant.
#
# Design:
#   - Runs as root in docker-entrypoint.sh BEFORE dropping to daemon
#   - Installs to /opt/tools/bin (added to PATH for all users)
#   - /opt/tools can be backed by a PVC for persistence across pod recreates
#   - Each tool has a version marker — only reinstalls if version changes
#   - Downloads are architecture-aware (amd64/arm64)
#   - Tolerant of network failures — logs warnings, doesn't block startup
#
# Tools installed:
#   kubectl, helm, aws-cli, gcloud, az, terraform, gh (already in image),
#   k9s, kubectx/kubens
# =============================================================================

set -o pipefail

TOOLS_DIR="${TOOLS_DIR:-/opt/tools}"
TOOLS_BIN="${TOOLS_DIR}/bin"
TOOLS_VERSIONS="${TOOLS_DIR}/.versions"
ARCH=$(dpkg --print-architecture 2>/dev/null || uname -m)

# Normalize arch
case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
esac

# Create directories
mkdir -p "$TOOLS_BIN" "$TOOLS_VERSIONS"

log() { echo "[tools] $*"; }
warn() { echo "[tools] WARNING: $*" >&2; }

# Check if tool version is already installed
is_installed() {
  local tool="$1" version="$2"
  [ -f "${TOOLS_VERSIONS}/${tool}" ] && [ "$(cat "${TOOLS_VERSIONS}/${tool}")" = "$version" ] && [ -f "${TOOLS_BIN}/${tool}" ]
}

mark_installed() {
  local tool="$1" version="$2"
  echo "$version" > "${TOOLS_VERSIONS}/${tool}"
}

# =============================================================================
# Tool Installers
# =============================================================================

install_kubectl() {
  local version="${KUBECTL_VERSION:-1.32.3}"
  if is_installed kubectl "$version"; then log "kubectl $version (cached)"; return 0; fi
  log "Installing kubectl $version..."
  if curl -fsSL "https://dl.k8s.io/release/v${version}/bin/linux/${ARCH}/kubectl" -o "${TOOLS_BIN}/kubectl"; then
    chmod +x "${TOOLS_BIN}/kubectl"
    mark_installed kubectl "$version"
    log "kubectl $version installed"
  else
    warn "kubectl install failed"
  fi
}

install_helm() {
  local version="${HELM_VERSION:-3.17.3}"
  if is_installed helm "$version"; then log "helm $version (cached)"; return 0; fi
  log "Installing helm $version..."
  if curl -fsSL "https://get.helm.sh/helm-v${version}-linux-${ARCH}.tar.gz" | tar -xz -C /tmp; then
    mv "/tmp/linux-${ARCH}/helm" "${TOOLS_BIN}/helm"
    chmod +x "${TOOLS_BIN}/helm"
    rm -rf "/tmp/linux-${ARCH}"
    mark_installed helm "$version"
    log "helm $version installed"
  else
    warn "helm install failed"
  fi
}

install_awscli() {
  local version="${AWSCLI_VERSION:-2}"
  if is_installed aws "$version" && [ -d "${TOOLS_DIR}/aws-cli" ]; then log "aws-cli (cached)"; return 0; fi
  # AWS CLI v2 only supports amd64 and arm64
  log "Installing aws-cli v2..."
  local url
  if [ "$ARCH" = "amd64" ]; then url="https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip"
  elif [ "$ARCH" = "arm64" ]; then url="https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip"
  else warn "aws-cli: unsupported arch $ARCH"; return 1; fi

  if curl -fsSL "$url" -o /tmp/awscli.zip; then
    unzip -qo /tmp/awscli.zip -d /tmp
    /tmp/aws/install --install-dir "${TOOLS_DIR}/aws-cli" --bin-dir "${TOOLS_BIN}" --update 2>/dev/null || \
    /tmp/aws/install --install-dir "${TOOLS_DIR}/aws-cli" --bin-dir "${TOOLS_BIN}" 2>/dev/null
    rm -rf /tmp/awscli.zip /tmp/aws
    mark_installed aws "$version"
    log "aws-cli installed"
  else
    warn "aws-cli install failed"
  fi
}

install_gcloud() {
  local version="${GCLOUD_VERSION:-latest}"
  if is_installed gcloud "$version" && [ -d "${TOOLS_DIR}/google-cloud-sdk" ]; then log "gcloud (cached)"; return 0; fi
  log "Installing gcloud SDK..."
  local garch="x86_64"
  [ "$ARCH" = "arm64" ] && garch="arm"
  if curl -fsSL "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-${garch}.tar.gz" -o /tmp/gcloud.tar.gz; then
    tar -xzf /tmp/gcloud.tar.gz -C "${TOOLS_DIR}"
    "${TOOLS_DIR}/google-cloud-sdk/install.sh" --quiet --path-update=false --usage-reporting=false --command-completion=false 2>/dev/null
    ln -sf "${TOOLS_DIR}/google-cloud-sdk/bin/gcloud" "${TOOLS_BIN}/gcloud"
    ln -sf "${TOOLS_DIR}/google-cloud-sdk/bin/gsutil" "${TOOLS_BIN}/gsutil"
    rm -f /tmp/gcloud.tar.gz
    mark_installed gcloud "$version"
    log "gcloud installed"
  else
    warn "gcloud install failed"
  fi
}

install_az() {
  local version="${AZ_VERSION:-latest}"
  if is_installed az "$version"; then log "az-cli (cached)"; return 0; fi
  log "Installing az-cli..."
  # Use the official install script (much smaller than pip install)
  if curl -fsSL https://aka.ms/InstallAzureCLIDeb -o /tmp/install-az.sh 2>/dev/null; then
    # The script installs via apt — run it but capture the binary location
    bash /tmp/install-az.sh -y 2>/dev/null
    rm -f /tmp/install-az.sh
    if command -v az >/dev/null 2>&1; then
      # Symlink to tools bin if not already there
      [ ! -f "${TOOLS_BIN}/az" ] && ln -sf "$(command -v az)" "${TOOLS_BIN}/az"
      mark_installed az "$version"
      log "az-cli installed"
    else
      warn "az-cli install completed but binary not found"
    fi
  else
    warn "az-cli install failed"
  fi
}

install_terraform() {
  local version="${TERRAFORM_VERSION:-1.12.1}"
  if is_installed terraform "$version"; then log "terraform $version (cached)"; return 0; fi
  log "Installing terraform $version..."
  if curl -fsSL "https://releases.hashicorp.com/terraform/${version}/terraform_${version}_linux_${ARCH}.zip" -o /tmp/tf.zip; then
    unzip -qo /tmp/tf.zip -d "${TOOLS_BIN}"
    chmod +x "${TOOLS_BIN}/terraform"
    rm -f /tmp/tf.zip
    mark_installed terraform "$version"
    log "terraform $version installed"
  else
    warn "terraform install failed"
  fi
}

install_k9s() {
  local version="${K9S_VERSION:-0.40.10}"
  if is_installed k9s "$version"; then log "k9s $version (cached)"; return 0; fi
  log "Installing k9s $version..."
  local k9s_arch="$ARCH"
  if curl -fsSL "https://github.com/derailed/k9s/releases/download/v${version}/k9s_Linux_${k9s_arch}.tar.gz" | tar -xz -C /tmp k9s; then
    mv /tmp/k9s "${TOOLS_BIN}/k9s"
    chmod +x "${TOOLS_BIN}/k9s"
    mark_installed k9s "$version"
    log "k9s $version installed"
  else
    warn "k9s install failed"
  fi
}

install_kubectx() {
  local version="${KUBECTX_VERSION:-0.9.5}"
  if is_installed kubectx "$version"; then log "kubectx $version (cached)"; return 0; fi
  log "Installing kubectx/kubens $version..."
  local base="https://github.com/ahmetb/kubectx/releases/download/v${version}"
  if curl -fsSL "${base}/kubectx_v${version}_linux_${ARCH}.tar.gz" | tar -xz -C /tmp kubectx && \
     curl -fsSL "${base}/kubens_v${version}_linux_${ARCH}.tar.gz" | tar -xz -C /tmp kubens; then
    mv /tmp/kubectx /tmp/kubens "${TOOLS_BIN}/"
    chmod +x "${TOOLS_BIN}/kubectx" "${TOOLS_BIN}/kubens"
    mark_installed kubectx "$version"
    log "kubectx/kubens $version installed"
  else
    warn "kubectx install failed"
  fi
}

# =============================================================================
# Main
# =============================================================================

log "============================================"
log "  Runtime Tools Installer (${ARCH})"
log "  Cache: ${TOOLS_DIR}"
log "============================================"

# Track timing
START_TIME=$(date +%s)

# Install all tools (failures are non-fatal)
install_kubectl
install_helm
install_awscli
install_terraform
install_k9s
install_kubectx

# These are larger/slower — install in background if FAST_BOOT=true
if [ "${FAST_BOOT}" = "true" ]; then
  log "FAST_BOOT: deferring gcloud and az-cli to background..."
  (install_gcloud && install_az) &
else
  install_gcloud
  install_az
fi

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

# Add to profile.d for interactive login shells
cat > /etc/profile.d/runtime-tools.sh << 'PROFILE'
export PATH="/opt/tools/bin:${PATH}"
PROFILE
chmod +x /etc/profile.d/runtime-tools.sh

# Summary
log "============================================"
log "  Tools ready (${ELAPSED}s)"
log "  $(ls "${TOOLS_BIN}" 2>/dev/null | wc -l) binaries in ${TOOLS_BIN}"
log "============================================"
