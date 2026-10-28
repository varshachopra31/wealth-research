FROM node:22-bookworm-slim
WORKDIR /app
COPY . .
RUN mkdir -p /data && chmod 777 /data
ENV IR_DATA_DIR=/data
ENV HOST=0.0.0.0
EXPOSE 8095
CMD ["node", "server.js"]
