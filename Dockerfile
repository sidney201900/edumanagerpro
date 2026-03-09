# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Copy production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy build artifacts and server
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./

EXPOSE 3000

CMD ["node", "server.js"]
