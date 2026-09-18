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
# Kubernetes runs app and preview Pods with runAsNonRoot and no runAsUser,
# so the runtime stage must name a numeric non-zero user and that user must
# own everything the app reads or writes. 1000:1000 is the node:22-alpine
# image's own "node" user, so /home/node already exists and is writable.
FROM node:22-alpine
WORKDIR /app
COPY --chown=1000:1000 package.json ./
# npm runs as root here, so hand the tree (including node_modules and the
# WORKDIR itself) to 1000:1000 before dropping privileges below.
RUN npm install --production \
 && chown -R 1000:1000 /app
COPY --chown=1000:1000 . .
# After COPY . . so the compiled stylesheet is not overwritten by the
# source tree (which deliberately does not contain one).
COPY --from=css --chown=1000:1000 /build/public/tailwind.css ./public/tailwind.css
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "server.js"]
