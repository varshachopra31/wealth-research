FROM node:24-slim
WORKDIR /app
COPY . .
ENV IR_DATA_DIR=/data
ENV PORT=8095
ENV HOST=0.0.0.0
EXPOSE 8095
CMD ["node", "server.js"]
