#!/bin/sh
# Container start (sandbox step S3): set the firewall as root, then *replace* this root shell with the
# unprivileged entrypoint, so no root process is left in the container: user node, no capabilities
# (bounding set emptied), no_new_privs for every descendant. A firewall failure stops the container.
set -e
node /opt/firewall.mjs
export HOME="${DSH_HOME:-/home/dsh}" USER=node
exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all --bounding-set=-all --no-new-privs \
  node /opt/entrypoint.mjs
