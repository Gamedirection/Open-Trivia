FROM node:18-alpine

LABEL org.opencontainers.image.source="https://github.com/Gamedirection/Open-Trivia"
LABEL org.opencontainers.image.url="https://github.com/Gamedirection/Open-Trivia"
LABEL org.opencontainers.image.title="Open-Trivia Frontend"
LABEL org.opencontainers.image.description="React frontend for Open-Trivia - multiplayer trivia platform with Share Play, leaderboards, Discord SSO, and admin tooling."
LABEL org.opencontainers.image.version="0.3.18"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.authors="GameDirection <gamedirection@users.noreply.github.com>"

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
RUN chmod +x /app/docker-entrypoint.sh
CMD ["/app/docker-entrypoint.sh"]
