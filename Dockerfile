FROM node:22.10.0-slim

ENV NODE_ENV=production

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm install --omit=dev \
	&& npm cache clean --force

# Copy app sources
COPY . .

# Expose default port
EXPOSE 5000

# Basic health check on root path
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "const http=require('http');const p=process.env.PORT||5000;http.get(`http://localhost:${p}/`,r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["sh", "/app/entrypoint.sh"]
