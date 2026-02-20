#!/bin/sh
set -e

VERSION="${REACT_APP_VERSION:-${APP_IMAGE_TAG:-}}"
LOGO_URL="${REACT_APP_BRAND_LOGO_URL:-}"

cat > /app/public/runtime-config.js <<EOF
window.__RUNTIME_CONFIG__ = {
  VERSION: "${VERSION}",
  BRAND_LOGO_URL: "${LOGO_URL}"
};
EOF

exec npm start
