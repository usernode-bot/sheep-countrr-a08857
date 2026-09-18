# Stage 1 — compile this app's Tailwind stylesheet.
#
# Runs on every image build (production deploys AND staging previews), so
# public/tailwind.css is always generated from the markup in THIS commit.
# That is why there is no committed CSS artifact to keep in sync and no
# rebuild step for you to remember: add a class, push, it is in the next
# build. tailwindcss lives only in this stage, so the runtime image below
# stays exactly as small as it was.
FROM node:22-alpine AS css
WORKDIR /build
COPY tailwind.config.js ./
COPY styles ./styles
COPY public ./public
RUN npm install tailwindcss@3.4.17 --no-audit --no-fund \
 && ./node_modules/.bin/tailwindcss \
      -c tailwind.config.js -i styles/tailwind-input.css \
      -o public/tailwind.css --minify

# Stage 2 — the app itself.
#
# The runtime stage must declare a NUMERIC non-root user: app and preview
# Pods run with runAsNonRoot: true and no runAsUser of their own, and
# Kubernetes cannot verify the uid behind a symbolic "USER node", so a
# root-default (or symbolically named) image fails with
# CreateContainerConfigError. 1000:1000 is the node image's existing
# node:node account, so its HOME (/home/node, used for the npm cache
# below) already exists and is writable.
FROM node:22-alpine
# /app is created here rather than implicitly by WORKDIR so it can be
# handed to the runtime uid before anything writes into it: npm install
# puts node_modules in this directory as that user.
RUN mkdir -p /app && chown 1000:1000 /app
WORKDIR /app
USER 1000:1000
COPY --chown=1000:1000 package.json ./
RUN npm install --production
COPY --chown=1000:1000 . .
# After COPY . . so the compiled stylesheet is not overwritten by the
# source tree (which deliberately does not contain one).
COPY --from=css --chown=1000:1000 /build/public/tailwind.css ./public/tailwind.css
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "server.js"]
