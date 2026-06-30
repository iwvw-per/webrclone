# Stage 1: Build React Frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
COPY frontend/libs/ ./libs/
RUN npm config set registry https://registry.npmmirror.com
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Go Backend
FROM golang:1.22-alpine AS backend-builder
WORKDIR /app
COPY backend/go.mod ./
RUN go mod download
COPY backend/ ./
# Copy compiled React assets to backend/dist for embedding
COPY --from=frontend-builder /app/dist ./dist
# Compile stripped static binary for Go
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o webrclone .

# Stage 3: Final Runner Image
FROM alpine:latest
# Install ca-certificates for https API calls and fuse for rclone mount capabilities
RUN apk add --no-cache ca-certificates fuse fuse3 tzdata
WORKDIR /app
COPY --from=backend-builder /app/webrclone /app/webrclone
EXPOSE 8080
ENTRYPOINT ["/app/webrclone"]
