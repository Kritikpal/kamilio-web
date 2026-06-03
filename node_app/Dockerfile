FROM node:20-alpine

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js apns.js ./

ENV PORT=5000
EXPOSE 5000

CMD ["node", "server.js"]
