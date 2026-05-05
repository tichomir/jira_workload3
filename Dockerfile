FROM node:20-alpine

# better-sqlite3 is a native addon and requires build tools on Alpine
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 4000

CMD ["npm", "run", "server"]
