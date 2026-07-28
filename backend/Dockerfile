# Build stage
FROM rust:bookworm AS builder
WORKDIR /app
COPY . .
RUN apt-get update && apt-get install -y pkg-config libssl-dev && cargo build --release

# Run stage
FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y ca-certificates libssl3 openssh-client sshpass && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/game-server-backend /app/game-server-backend
ENV PORT=8081
EXPOSE 8081
CMD ["/app/game-server-backend"]
