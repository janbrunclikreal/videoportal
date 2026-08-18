FROM node:18-alpine

RUN apk add --no-cache sqlite

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY app.js reset-admin-system.sh ./

EXPOSE 8081

CMD ["npm", "start"]
