# Estágio 1: Build
FROM node:20-alpine AS build

WORKDIR /app

# Copia arquivos de dependências
COPY package*.json ./

# Instala todas as dependências (incluindo devDependencies para o build)
RUN npm install

# Copia o resto do código
COPY . .
RUN echo "VITE_SUPABASE_URL=https://ekbuvcjsfcczviqqlfit.supabase.co" > .env
RUN echo "VITE_SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrYnV2Y2pzZmNjenZpcXFsZml0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5OTU0MzIsImV4cCI6MjA4NjU3MTQzMn0.oIzBeGF-PjaviZejYb1TeOOEzMm-Jjth1XzvJrjD6us" >> .env
RUN npm run build
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
