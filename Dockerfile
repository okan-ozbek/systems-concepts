FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.28-alpine
ENV TRUSTED_PROXY=127.0.0.1/32 NGINX_ENVSUBST_FILTER=TRUSTED_PROXY
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY deploy/nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
