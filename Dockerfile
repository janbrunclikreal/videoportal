FROM node:20-alpine

# Nástroje pro kompilaci nativního better-sqlite3 modulu na Alpine
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

# Nejprve závislosti (kvůli efektivnímu cachování Docker vrstev)
COPY package*.json ./
RUN npm ci --omit=dev

# Zkopírování kompletního kódu v2 aplikace
COPY src/ ./src/
COPY public/ ./public/
COPY database/ ./database/

# Vytvoření adresářů pro persistenci a logy
RUN mkdir -p database logs uploads

EXPOSE 8081

CMD ["npm", "start"]
