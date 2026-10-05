ARG TEX_BASE=registry.gitlab.com/islandoftex/images/texlive:TL2025-historic
FROM ${TEX_BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*
COPY run-job.sh /usr/local/bin/work-compile
RUN chmod 0555 /usr/local/bin/work-compile
USER 65532:65532
WORKDIR /job
ENTRYPOINT ["/usr/local/bin/work-compile"]
