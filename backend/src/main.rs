use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use std::collections::{HashMap, VecDeque};
use std::env;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tower_http::cors::{Any, CorsLayer};

#[derive(Serialize, Deserialize, sqlx::FromRow, Clone)]
struct GameServerDb {
    id: i32,
    name: String,
    agent_url: String,
    agent_token: String,
    status: String,
    ssh_host: Option<String>,
    ssh_port: Option<i32>,
    ssh_user: Option<String>,
    ssh_password: Option<String>,
}

#[derive(sqlx::FromRow)]
struct MetricDbRow {
    timestamp: chrono::DateTime<chrono::Utc>,
    cpu_percent: f32,
    memory_percent: f32,
}

#[derive(Serialize)]
struct ServerOverview {
    id: i32,
    name: String,
    agent_url: String,
    status: String,
    latest_cpu: Option<f32>,
    latest_mem: Option<f32>,
    container_count: usize,
    running_containers: Vec<String>,
    host_total_connections: Option<usize>,
    host_unique_connections: Option<usize>,
}

#[derive(Deserialize)]
struct CreateServerPayload {
    name: String,
    agent_url: String,
    agent_token: String,
    ssh_host: Option<String>,
    ssh_port: Option<i32>,
    ssh_user: Option<String>,
    ssh_password: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct HostMetrics {
    cpu_percent: f32,
    memory_percent: f32,
    memory_total_mb: u64,
    memory_used_mb: u64,
    uptime_seconds: u64,
    total_connections: Option<usize>,
    unique_connections: Option<usize>,
}

#[derive(Deserialize, Serialize, Clone)]
struct ContainerInfo {
    id: String,
    name: String,
    image: String,
    status: String,
    state: String,
    total_connections: Option<usize>,
    unique_connections: Option<usize>,
}

#[derive(Deserialize)]
struct MetricsResponse {
    host: HostMetrics,
    containers: Vec<ContainerInfo>,
}

#[derive(Serialize, Clone)]
struct MetricHistoryPoint {
    timestamp: String,
    host_cpu: f32,
    host_mem: f32,
}

struct MetricsCache {
    history: HashMap<i32, VecDeque<MetricHistoryPoint>>,
    containers: HashMap<i32, Vec<ContainerInfo>>,
    hosts: HashMap<i32, HostMetrics>,
}

struct AppState {
    pool: sqlx::PgPool,
    cache: Arc<Mutex<MetricsCache>>,
    http_client: reqwest::Client,
}

#[tokio::main]
async fn main() {
    let db_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postman_user:postman_password@localhost:5432/postman_clone".to_string());
    let port = env::var("PORT").unwrap_or_else(|_| "8081".to_string());
    let addr = format!("0.0.0.0:{}", port);

    // Setup PostgreSQL Pool
    let pool = match PgPoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Failed to connect to database: {}", e);
            std::process::exit(1);
        }
    };

    // Initialize Schema
    init_db(&pool).await.expect("Database migration failed");

    let cache = Arc::new(Mutex::new(MetricsCache {
        history: HashMap::new(),
        containers: HashMap::new(),
        hosts: HashMap::new(),
    }));

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();

    let state = Arc::new(AppState {
        pool: pool.clone(),
        cache: cache.clone(),
        http_client: http_client.clone(),
    });

    // Start Polling Loop Worker thread
    tokio::spawn(start_polling_worker(pool.clone(), cache.clone(), http_client.clone()));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_headers(Any)
        .allow_methods(Any);

    let app = Router::new()
        .route("/api/overview", get(get_overview))
        .route("/api/servers", get(list_servers).post(create_server))
        .route("/api/servers/:id", delete(delete_server).put(update_server))
        .route("/api/servers/:id/containers", get(get_server_containers))
        .route("/api/servers/:id/history", get(get_server_history))
        .route("/api/servers/:id/containers/:container_id/stats", get(proxy_container_stats))
        .route("/api/servers/:id/containers/:container_id/logs", get(proxy_container_logs))
        .route("/api/servers/:id/containers/:container_id/action", post(proxy_container_action))
        .route("/api/servers/:id/ssh/ws", get(handle_ssh_ws))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("Dashboard Admin Backend listening on http://{}", addr);
    axum::serve(listener, app).await.unwrap();
}

async fn init_db(pool: &sqlx::PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS game_servers (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            agent_url VARCHAR(255) NOT NULL,
            agent_token VARCHAR(255) NOT NULL,
            status VARCHAR(50) DEFAULT 'unknown',
            ssh_host VARCHAR(255),
            ssh_port INT DEFAULT 22,
            ssh_user VARCHAR(255) DEFAULT 'root',
            ssh_password VARCHAR(255) DEFAULT ''
        )"
    )
    .execute(pool)
    .await?;

    let _ = sqlx::query("ALTER TABLE game_servers ADD COLUMN IF NOT EXISTS ssh_host VARCHAR(255)").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE game_servers ADD COLUMN IF NOT EXISTS ssh_port INT DEFAULT 22").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE game_servers ADD COLUMN IF NOT EXISTS ssh_user VARCHAR(255) DEFAULT 'root'").execute(pool).await;
    let _ = sqlx::query("ALTER TABLE game_servers ADD COLUMN IF NOT EXISTS ssh_password VARCHAR(255) DEFAULT ''").execute(pool).await;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS server_metrics_history (
            id SERIAL PRIMARY KEY,
            server_id INT NOT NULL REFERENCES game_servers(id) ON DELETE CASCADE,
            timestamp TIMESTAMPTZ DEFAULT NOW(),
            cpu_percent REAL NOT NULL,
            memory_percent REAL NOT NULL
        )"
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn start_polling_worker(
    pool: sqlx::PgPool,
    cache: Arc<Mutex<MetricsCache>>,
    client: reqwest::Client,
) {
    loop {
        if let Ok(servers) = sqlx::query_as::<_, GameServerDb>(
            "SELECT id, name, agent_url, agent_token, status, ssh_host, ssh_port, ssh_user, ssh_password FROM game_servers"
        )
        .fetch_all(&pool)
        .await
        {
            for server in servers {
                let client_clone = client.clone();
                let cache_clone = cache.clone();
                let pool_clone = pool.clone();

                tokio::spawn(async move {
                    let url = format!("{}/metrics", server.agent_url);
                    let res = client_clone
                        .get(&url)
                        .header("Authorization", format!("Bearer {}", server.agent_token))
                        .send()
                        .await;

                    match res {
                        Ok(resp) => {
                            if resp.status().is_success() {
                                if let Ok(metrics) = resp.json::<MetricsResponse>().await {
                                    // Update DB status to 'online'
                                    let _ = sqlx::query("UPDATE game_servers SET status = 'online' WHERE id = $1")
                                        .bind(server.id)
                                        .execute(&pool_clone)
                                        .await;

                                    // Insert history metrics into database
                                    let _ = sqlx::query(
                                        "INSERT INTO server_metrics_history (server_id, cpu_percent, memory_percent)
                                         VALUES ($1, $2, $3)"
                                    )
                                    .bind(server.id)
                                    .bind(metrics.host.cpu_percent)
                                    .bind(metrics.host.memory_percent)
                                    .execute(&pool_clone)
                                    .await;

                                    // Update in-memory cache history
                                    let mut c = cache_clone.lock().unwrap();
                                    let history = c.history.entry(server.id).or_insert_with(VecDeque::new);

                                    let now = chrono::Local::now().format("%H:%M:%S").to_string();
                                    history.push_back(MetricHistoryPoint {
                                        timestamp: now,
                                        host_cpu: metrics.host.cpu_percent,
                                        host_mem: metrics.host.memory_percent,
                                    });

                                    if history.len() > 30 {
                                        history.pop_front();
                                    }

                                    // Update containers and host metrics
                                    c.containers.insert(server.id, metrics.containers);
                                    c.hosts.insert(server.id, metrics.host);
                                } else {
                                    eprintln!("[-] Server ID {}: Failed to parse JSON metrics from Agent", server.id);
                                }
                            } else {
                                eprintln!("[-] Server ID {}: Agent returned status error: {}", server.id, resp.status());
                                let _ = sqlx::query("UPDATE game_servers SET status = 'offline' WHERE id = $1")
                                    .bind(server.id)
                                    .execute(&pool_clone)
                                    .await;
                            }
                        }
                        Err(e) => {
                            eprintln!("[-] Server ID {}: Failed to connect to Agent at {}. Error: {}", server.id, server.agent_url, e);
                            let _ = sqlx::query("UPDATE game_servers SET status = 'offline' WHERE id = $1")
                                .bind(server.id)
                                .execute(&pool_clone)
                                .await;
                        }
                    }
                });
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
    }
}

// Handlers
async fn list_servers(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<GameServerDb>>, StatusCode> {
    let servers = sqlx::query_as::<_, GameServerDb>(
        "SELECT id, name, agent_url, agent_token, status, ssh_host, ssh_port, ssh_user, ssh_password FROM game_servers ORDER BY id ASC"
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(servers))
}

async fn create_server(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateServerPayload>,
) -> Result<Json<GameServerDb>, StatusCode> {
    let server = sqlx::query_as::<_, GameServerDb>(
        "INSERT INTO game_servers (name, agent_url, agent_token, status, ssh_host, ssh_port, ssh_user, ssh_password)
         VALUES ($1, $2, $3, 'unknown', $4, $5, $6, $7)
         RETURNING id, name, agent_url, agent_token, status, ssh_host, ssh_port, ssh_user, ssh_password"
    )
    .bind(payload.name)
    .bind(payload.agent_url)
    .bind(payload.agent_token)
    .bind(payload.ssh_host)
    .bind(payload.ssh_port.unwrap_or(22))
    .bind(payload.ssh_user.unwrap_or_else(|| "root".to_string()))
    .bind(payload.ssh_password.unwrap_or_default())
    .fetch_one(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(server))
}

async fn delete_server(
    Path(id): Path<i32>,
    State(state): State<Arc<AppState>>,
) -> Result<StatusCode, StatusCode> {
    sqlx::query("DELETE FROM game_servers WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

#[derive(Deserialize)]
struct UpdateServerPayload {
    name: String,
    agent_url: String,
    agent_token: String,
    ssh_host: Option<String>,
    ssh_port: Option<i32>,
    ssh_user: Option<String>,
    ssh_password: Option<String>,
}

async fn update_server(
    Path(id): Path<i32>,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UpdateServerPayload>,
) -> Result<Json<GameServerDb>, StatusCode> {
    let server = sqlx::query_as::<_, GameServerDb>(
        "UPDATE game_servers
         SET name = $1, agent_url = $2, agent_token = $3, status = 'unknown',
             ssh_host = $4, ssh_port = $5, ssh_user = $6, ssh_password = $7
         WHERE id = $8
         RETURNING id, name, agent_url, agent_token, status, ssh_host, ssh_port, ssh_user, ssh_password"
    )
    .bind(payload.name)
    .bind(payload.agent_url)
    .bind(payload.agent_token)
    .bind(payload.ssh_host)
    .bind(payload.ssh_port.unwrap_or(22))
    .bind(payload.ssh_user.unwrap_or_else(|| "root".to_string()))
    .bind(payload.ssh_password.unwrap_or_default())
    .bind(id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to update server: {:?}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(server))
}

async fn get_server_containers(
    Path(id): Path<i32>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<ContainerInfo>>, StatusCode> {
    let c = state.cache.lock().unwrap();
    let list = c.containers.get(&id).cloned().unwrap_or_default();
    Ok(Json(list))
}

#[derive(Deserialize)]
struct HistoryFilter {
    start_date: Option<String>,
    end_date: Option<String>,
    hours: Option<i32>,
}

async fn get_server_history(
    Path(id): Path<i32>,
    State(state): State<Arc<AppState>>,
    Query(filter): Query<HistoryFilter>,
) -> Result<Json<Vec<MetricHistoryPoint>>, StatusCode> {
    if let Some(hours) = filter.hours {
        // Hour-based filter: fetch data from last N hours
        let rows = sqlx::query_as::<_, MetricDbRow>(
            "SELECT timestamp, cpu_percent, memory_percent 
             FROM server_metrics_history 
             WHERE server_id = $1 
               AND timestamp >= NOW() - CAST($2 || ' hours' AS INTERVAL)
             ORDER BY timestamp ASC"
        )
        .bind(id)
        .bind(hours.to_string())
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to fetch hours-filtered history: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        let points = rows.into_iter().map(|r| {
            let local_time = r.timestamp.with_timezone(&chrono::Local);
            MetricHistoryPoint {
                timestamp: local_time.format("%H:%M:%S").to_string(),
                host_cpu: r.cpu_percent,
                host_mem: r.memory_percent,
            }
        }).collect();

        Ok(Json(points))
    } else if let (Some(start), Some(end)) = (filter.start_date, filter.end_date) {
        // Parse dates - use local timezone query formatting (+0700)
        let start_ts = format!("{} 00:00:00 +0700", start);
        let end_ts = format!("{} 23:59:59 +0700", end);

        let rows = sqlx::query_as::<_, MetricDbRow>(
            "SELECT timestamp, cpu_percent, memory_percent 
             FROM server_metrics_history 
             WHERE server_id = $1 
               AND timestamp >= TIMESTAMPTZ ($2) 
               AND timestamp <= TIMESTAMPTZ ($3) 
             ORDER BY timestamp ASC"
        )
        .bind(id)
        .bind(start_ts)
        .bind(end_ts)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to fetch filtered history: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        let points = rows.into_iter().map(|r| {
            let local_time = r.timestamp.with_timezone(&chrono::Local);
            MetricHistoryPoint {
                timestamp: local_time.format("%m-%d %H:%M:%S").to_string(),
                host_cpu: r.cpu_percent,
                host_mem: r.memory_percent,
            }
        }).collect();

        Ok(Json(points))
    } else {
        // Return latest 30 points from database
        let rows = sqlx::query_as::<_, MetricDbRow>(
            "SELECT timestamp, cpu_percent, memory_percent 
             FROM server_metrics_history 
             WHERE server_id = $1 
             ORDER BY timestamp DESC 
             LIMIT 30"
        )
        .bind(id)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to fetch default history: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        let mut points: Vec<MetricHistoryPoint> = rows.into_iter().map(|r| {
            let local_time = r.timestamp.with_timezone(&chrono::Local);
            MetricHistoryPoint {
                timestamp: local_time.format("%H:%M:%S").to_string(),
                host_cpu: r.cpu_percent,
                host_mem: r.memory_percent,
            }
        }).collect();

        points.reverse();
        Ok(Json(points))
    }
}

async fn proxy_container_stats(
    Path((id, container_id)): Path<(i32, String)>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let server = sqlx::query_as::<_, GameServerDb>(
        "SELECT id, name, agent_url, agent_token, status, ssh_host, ssh_port, ssh_user, ssh_password FROM game_servers WHERE id = $1"
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| StatusCode::NOT_FOUND)?;

    let url = format!("{}/containers/{}/stats", server.agent_url, container_id);
    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", server.agent_token))
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    if resp.status().is_success() {
        let stats_json = resp.json::<serde_json::Value>().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(Json(stats_json))
    } else {
        Err(StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY))
    }
}

async fn proxy_container_logs(
    Path((id, container_id)): Path<(i32, String)>,
    State(state): State<Arc<AppState>>,
) -> Result<String, StatusCode> {
    let server = sqlx::query_as::<_, GameServerDb>(
        "SELECT id, name, agent_url, agent_token, status, ssh_host, ssh_port, ssh_user, ssh_password FROM game_servers WHERE id = $1"
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| StatusCode::NOT_FOUND)?;

    let url = format!("{}/containers/{}/logs", server.agent_url, container_id);
    let resp = state
        .http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", server.agent_token))
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    if resp.status().is_success() {
        let logs_str = resp.text().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(logs_str)
    } else {
        Err(StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY))
    }
}

#[derive(Deserialize, Serialize)]
struct ActionPayload {
    action: String,
}

async fn proxy_container_action(
    Path((id, container_id)): Path<(i32, String)>,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ActionPayload>,
) -> Result<StatusCode, StatusCode> {
    let server = sqlx::query_as::<_, GameServerDb>(
        "SELECT id, name, agent_url, agent_token, status, ssh_host, ssh_port, ssh_user, ssh_password FROM game_servers WHERE id = $1"
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| StatusCode::NOT_FOUND)?;

    let url = format!("{}/containers/{}/action", server.agent_url, container_id);
    let resp = state
        .http_client
        .post(&url)
        .header("Authorization", format!("Bearer {}", server.agent_token))
        .json(&payload)
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    if resp.status().is_success() {
        Ok(StatusCode::OK)
    } else {
        Err(StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY))
    }
}

async fn get_overview(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<ServerOverview>>, StatusCode> {
    let servers = sqlx::query_as::<_, GameServerDb>(
        "SELECT id, name, agent_url, agent_token, status, ssh_host, ssh_port, ssh_user, ssh_password FROM game_servers ORDER BY id ASC"
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to fetch servers for overview: {:?}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let mut result = Vec::new();
    let cache = state.cache.lock().unwrap();

    for s in servers {
        let history = cache.history.get(&s.id);
        let latest_point = history.and_then(|h| h.back());
        let (latest_cpu, latest_mem) = match latest_point {
            Some(pt) => (Some(pt.host_cpu), Some(pt.host_mem)),
            None => (None, None),
        };

        let containers = cache.containers.get(&s.id);
        let container_count = containers.map(|c| c.len()).unwrap_or(0);
        let running_containers = containers
            .map(|c| c.iter().map(|item| item.name.clone()).collect())
            .unwrap_or_else(Vec::new);

        let host_metrics = cache.hosts.get(&s.id);
        let host_total_connections = host_metrics.and_then(|h| h.total_connections);
        let host_unique_connections = host_metrics.and_then(|h| h.unique_connections);

        result.push(ServerOverview {
            id: s.id,
            name: s.name,
            agent_url: s.agent_url,
            status: s.status,
            latest_cpu,
            latest_mem,
            container_count,
            running_containers,
            host_total_connections,
            host_unique_connections,
        });
    }

    Ok(Json(result))
}

// WebSocket SSH Handler
#[derive(Deserialize)]
struct SshWsQuery {
    ssh_host: Option<String>,
    ssh_port: Option<i32>,
    ssh_user: Option<String>,
    ssh_password: Option<String>,
}

async fn handle_ssh_ws(
    ws: WebSocketUpgrade,
    Path(id): Path<i32>,
    Query(query): Query<SshWsQuery>,
    State(state): State<Arc<AppState>>,
) -> Result<axum::response::Response, StatusCode> {
    let server = sqlx::query_as::<_, GameServerDb>(
        "SELECT id, name, agent_url, agent_token, status, ssh_host, ssh_port, ssh_user, ssh_password FROM game_servers WHERE id = $1"
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| StatusCode::NOT_FOUND)?;

    let host = query.ssh_host.or(server.ssh_host).unwrap_or_else(|| {
        server.agent_url
            .trim_start_matches("http://")
            .trim_start_matches("https://")
            .split(':')
            .next()
            .unwrap_or("localhost")
            .to_string()
    });

    let host = if host.trim().is_empty() {
        server.agent_url
            .trim_start_matches("http://")
            .trim_start_matches("https://")
            .split(':')
            .next()
            .unwrap_or("localhost")
            .to_string()
    } else {
        host
    };

    let port = query.ssh_port.or(server.ssh_port).unwrap_or(22);
    let user = query.ssh_user.or(server.ssh_user).unwrap_or_else(|| "root".to_string());
    let user = if user.trim().is_empty() { "root".to_string() } else { user };
    let password = query.ssh_password.or(server.ssh_password).unwrap_or_default();

    Ok(ws.on_upgrade(move |socket| handle_ssh_socket(socket, host, port, user, password)))
}

async fn handle_ssh_socket(
    socket: WebSocket,
    host: String,
    port: i32,
    user: String,
    password: String,
) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    let mut cmd = Command::new("sshpass");
    cmd.arg("-p").arg(&password);
    cmd.arg("ssh");
    cmd.arg("-t");
    cmd.arg("-t");
    cmd.arg("-o").arg("StrictHostKeyChecking=no");
    cmd.arg("-o").arg("UserKnownHostsFile=/dev/null");
    cmd.arg("-p").arg(port.to_string());
    cmd.arg(format!("{}@{}", user, host));
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = ws_sender.send(Message::Text(format!("\r\n[Lỗi] Không thể tạo tiến trình SSH: {}\r\n", e))).await;
            return;
        }
    };

    let mut child_stdin = child.stdin.take().expect("Failed to open stdin");
    let mut child_stdout = child.stdout.take().expect("Failed to open stdout");
    let mut child_stderr = child.stderr.take().expect("Failed to open stderr");

    let ws_sender_arc = Arc::new(tokio::sync::Mutex::new(ws_sender));

    let ws_sender_out = ws_sender_arc.clone();
    let stdout_task = tokio::spawn(async move {
        let mut buf = [0u8; 2048];
        loop {
            match child_stdout.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let mut lock = ws_sender_out.lock().await;
                    if lock.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let ws_sender_err = ws_sender_arc.clone();
    let stderr_task = tokio::spawn(async move {
        let mut buf = [0u8; 2048];
        loop {
            match child_stderr.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let mut lock = ws_sender_err.lock().await;
                    if lock.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    while let Some(Ok(msg)) = ws_receiver.next().await {
        match msg {
            Message::Text(text) => {
                if child_stdin.write_all(text.as_bytes()).await.is_err() {
                    break;
                }
            }
            Message::Binary(bytes) => {
                if child_stdin.write_all(&bytes).await.is_err() {
                    break;
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    let _ = child.kill().await;
    stdout_task.abort();
    stderr_task.abort();
}
