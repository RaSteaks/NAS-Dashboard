FROM registry.k8s.io/git-sync/git-sync:v4.7.1

# Match the existing NAS bind-mount ownership; Web Station only reads the files.
USER 0:0

# Git-sync reads these defaults; the wrapper publishes an ordinary site directory.
ENV GITSYNC_REPO=https://github.com/RaSteaks/NAS-Dashboard.git \
    GITSYNC_REF=main \
    GITSYNC_ROOT=/data/.sync \
    GITSYNC_LINK=/data/current \
    GITSYNC_ONE_TIME=true \
    GITSYNC_SYNC_TIMEOUT=120s

COPY publish.sh /usr/local/bin/nas-dashboard-sync
RUN chmod 755 /usr/local/bin/nas-dashboard-sync
ENTRYPOINT ["/usr/local/bin/nas-dashboard-sync"]

# Identify the publisher release separately from the website revision synced at runtime.
ARG VERSION=1.0.2
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="NAS Dashboard Sync" \
    org.opencontainers.image.source="https://github.com/RaSteaks/NAS-Dashboard" \
    org.opencontainers.image.version=${VERSION} \
    org.opencontainers.image.revision=${VCS_REF}
