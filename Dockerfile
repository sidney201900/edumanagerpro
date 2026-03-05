# Estágio 1: Build
FROM node:20-alpine AS build

WORKDIR /app

# Copia arquivos de dependências
COPY package*.json ./

# Instala todas as dependências (incluindo devDependencies para o build)
RUN npm install

# Copia o resto do código
COPY . .

# Gera o build do Vite (pasta dist)
RUN npm run build

# Estágio 2: Produção
FROM node:20-alpine

WORKDIR /app

# Copia apenas o necessário do estágio de build
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
COPY --from=build /app/server.js ./

# Instala apenas dependências de produção
RUN npm install --omit=dev

# Exponha a porta 3000
EXPOSE 3000

# Comando de inicialização
CMD ["node", "server.js"]
