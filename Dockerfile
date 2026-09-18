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
FROM node:22-alpine
WORKDIR /app

# Everything the runtime user needs is copied in already owned by uid 1000,
# so nothing has to be chowned after the fact and nothing is left root-owned.
# (node:22-alpine ships a `node` user at 1000:1000; we name it numerically
# because Kubernetes sets runAsNonRoot without a runAsUser and cannot verify
# the UID behind a symbolic name.)
COPY --chown=1000:1000 package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && chown -R 1000:1000 /app
COPY --chown=1000:1000 . .
# After COPY . . so the compiled stylesheet is not overwritten by the
# source tree (which deliberately does not contain one).
COPY --from=css --chown=1000:1000 /build/public/tailwind.css ./public/tailwind.css

# Non-root from here on. The app itself writes nothing to disk (all state
# lives in Postgres), but npm and node still want a writable HOME for their
# caches, and /app is owned by the same uid so a future write target inside
# the app dir works without another chown.
ENV HOME=/home/node
USER 1000:1000

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
# Exec form: node is PID 1 and receives SIGTERM directly, so the graceful
# shutdown handler in server.js actually runs instead of being swallowed by
# an intermediate shell.
CMD ["node", "server.js"]
