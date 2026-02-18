# syntax=docker/dockerfile:1.16.0@sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6
# check=error=true

# Find the latest version at https://catalog.redhat.com/software/containers/ubi10/ubi-minimal
# IMPORTANT: Make sure to use the "Manifest List Digest" that references the images for multiple architectures
# rather than just the "Image Digest" that references the image for the selected architecture.
FROM registry.access.redhat.com/ubi10/ubi-minimal@sha256:a74a7a92d3069bfac09c6882087771fc7db59fa9d8e16f14f4e012fe7288554c AS base

# Sets the default shell to Bash with strict error handling and robust pipeline processing.
# "-e": Exits immediately if a command exits with a non-zero status
# "-u": Treats unset variables as an error, preventing unexpected behavior from undefined variables.
# "-o pipefail": Causes a pipeline to return the exit status of the last command in the pipe that failed, ensuring errors in any part of a pipeline are not ignored.
# "-c": Allows the execution of commands passed as a string
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]

ARG TARGETARCH=amd64

COPY .node-version /tmp/.node-version

RUN NODEJS_VERSION=$(cat /tmp/.node-version) && \
    case "${TARGETARCH}" in \
        amd64|x86_64|x86) NODEJS_ARCH="x64" ;; \
        arm64|aarch64) NODEJS_ARCH="arm64" ;; \
        *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    microdnf update -y && \
    microdnf install -y curl tar gzip && \
    microdnf clean all && \
    curl -fsSL "https://nodejs.org/dist/v${NODEJS_VERSION}/node-v${NODEJS_VERSION}-linux-${NODEJS_ARCH}.tar.gz" \
        | tar -xzf - --strip-components=1 -C /usr/local

#
# Build stage - compiles the SvelteKit application
#
FROM base AS builder

ARG VERSION

WORKDIR /build

# Copy package files for dependency installation
COPY package.json package-lock.json .npmrc ./

# Install all dependencies (including dev dependencies for build)
RUN --mount=type=cache,target=/root/.npm npm ci

# Copy source code and configuration files
COPY src/ ./src/
COPY static/ ./static/
COPY svelte.config.js tsconfig.json vite.config.ts ./

# Build the application
RUN npm run build

# Install only production dependencies
RUN --mount=type=cache,target=/root/.npm npm ci --omit dev

#
# Production stage - minimal runtime image
#
FROM base AS final

ARG VERSION

ENV STACKABLE_USER_UID=1000 \
    STACKABLE_USER_GID=1000 \
    STACKABLE_USER_NAME=stackable \
    NODE_ENV=production

RUN microdnf install -y shadow-utils && \
    groupadd --gid ${STACKABLE_USER_GID} --system ${STACKABLE_USER_NAME} && \
    useradd \
        --no-log-init \
        --gid ${STACKABLE_USER_GID} \
        --uid ${STACKABLE_USER_UID} \
        --system \
        --create-home \
        --home-dir /stackable \
        ${STACKABLE_USER_NAME} && \
    microdnf remove -y shadow-utils && \
    microdnf clean all

WORKDIR /stackable/app

# Copy built application from builder stage
COPY --from=builder --chown=${STACKABLE_USER_UID}:0 /build/build ./build
COPY --from=builder --chown=${STACKABLE_USER_UID}:0 /build/node_modules ./node_modules
COPY --from=builder --chown=${STACKABLE_USER_UID}:0 /build/package.json ./
RUN chmod -R g=u /stackable/app

USER ${STACKABLE_USER_UID}

# These labels have mostly been superceded by the OpenContainer spec annotations below but it doesn't hurt to include them
# http://label-schema.org/rc1/
LABEL maintainer="info@stackable.tech"
LABEL vendor="Stackable GmbH"

# Overwriting/Pinning UBI labels
# https://github.com/projectatomic/ContainerApplicationGenericLabels
LABEL vcs-ref=""
LABEL distribution-scope="public"
LABEL url="https://stackable.tech"
ARG TARGETARCH
LABEL architecture="${TARGETARCH}"
LABEL com.redhat.component=""
# It complains about it being an invalid label but RedHat uses it and we want to override it and it works....
# hadolint ignore=DL3048
LABEL com.redhat.license_terms=""
LABEL io.buildah.version=""
LABEL io.openshift.expose-services=""

# https://github.com/opencontainers/image-spec/blob/036563a4a268d7c08b51a08f05a02a0fe74c7268/annotations.md#annotations
LABEL org.opencontainers.image.authors="info@stackable.tech"
LABEL org.opencontainers.image.url="https://stackable.tech"
LABEL org.opencontainers.image.source="https://github.com/stackabletech/stackable-ui/"
LABEL org.opencontainers.image.vendor="Stackable GmbH"

CMD ["node", "build/index.js"]
