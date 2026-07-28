use axum::{
    async_trait,
    extract::{FromRequestParts, Path, State},
    http::{request::Parts, StatusCode},
    routing::{get, post},
    Json, Router,
};
use bollard::container::{ListContainersOptions, LogsOptions, StatsOptions};
use bollard::Docker;
use futures_util::stream::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::env;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use chrono::{DateTime, Utc};
use sysinfo::System;

struct AppState {
    docker: Option<Docker>,
    monitor_ports: Vec<u16>,
}

struct AuthToken;

#[async_trait]
impl<S> FromRequestParts<S> for AuthToken
where
    S: Send + Sync,
{
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get("Authorization")
            .and_then(|value| value.to_str().ok())
            .ok_or(StatusCode::UNAUTHORIZED)?;

        let expected_token = env::var("AGENT_SECRET_TOKEN")
            .unwrap_or_else(|_| "secret-agent-token-123".to_string());

        let expected_header = format!("Bearer {}", expected_token);

        if auth_header == expected_header {
            Ok(AuthToken)
        } else {
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

#[derive(Serialize)]
struct HostMetrics {
    cpu_percent: f32,
    memory_total_mb: u64,
    memory_used_mb: u64,
    memory_percent: f32,
    uptime_seconds: u64,
    total_connections: usize,
    unique_connections: usize,
}

#[derive(Serialize)]
struct ContainerInfo {
    id: String,
    name: String,
    image: String,
    status: String,
    state: String,
    total_connections: usize,
    unique_connections: usize,
}

#[derive(Serialize)]
struct MetricsResponse {
    host: HostMetrics,
    containers: Vec<ContainerInfo>,
}

#[derive(Serialize, Clone, Debug)]
struct PortConnectionStats {
    port: u16,
    total_connections: usize,
    unique_connections: usize,
    unique_ips: Vec<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
struct ConnectionMetrics {
    total_connections: usize,
    unique_connections: usize,
    unique_ips: Vec<String>,
    ports_stats: Vec<PortConnectionStats>,
}

#[derive(Serialize)]
struct ContainerStats {
    id: String,
    name: String,
    status: String,
    cpu_percent: f64,
    memory_used_bytes: u64,
    memory_limit_bytes: u64,
    memory_percent: f64,
    network_rx_bytes: u64,
    network_tx_bytes: u64,
    block_read_bytes: u64,
    block_write_bytes: u64,
    ip_address: String,
    ports: Vec<String>,
    uptime_seconds: u64,
    total_connections: usize,
    unique_connections: usize,
    ports_stats: Vec<PortConnectionStats>,
}

fn hex_to_ipv4(hex_str: &str) -> Option<String> {
    if hex_str.len() != 8 {
        return None;
    }
    let num = u32::from_str_radix(hex_str, 16).ok()?;
    let bytes = num.to_le_bytes();
    Some(format!("{}.{}.{}.{}", bytes[0], bytes[1], bytes[2], bytes[3]))
}

fn hex_to_ipv6(hex_str: &str) -> Option<String> {
    if hex_str.len() != 32 {
        return None;
    }
    let mut words = [0u32; 4];
    for i in 0..4 {
        words[i] = u32::from_str_radix(&hex_str[i * 8..(i + 1) * 8], 16).ok()?;
    }
    let mut bytes = [0u8; 16];
    for i in 0..4 {
        let b = words[i].to_le_bytes();
        bytes[i * 4..(i + 1) * 4].copy_from_slice(&b);
    }
    let ip6 = std::net::Ipv6Addr::from(bytes);
    Some(ip6.to_string())
}

fn parse_proc_net_tcp_file(
    file_path: &str,
    is_ipv6: bool,
    target_ports: &[u16],
    port_map: &mut HashMap<u16, (usize, HashSet<String>)>,
) {
    if let Ok(file) = File::open(file_path) {
        let reader = BufReader::new(file);
        for line in reader.lines().skip(1) {
            if let Ok(l) = line {
                let parts: Vec<&str> = l.split_whitespace().collect();
                if parts.len() < 4 {
                    continue;
                }

                let local_addr = parts[1];
                let rem_addr = parts[2];
                let state = parts[3];

                // Only count ESTABLISHED sockets ("01")
                if state != "01" {
                    continue;
                }

                if let Some(port_hex) = local_addr.split(':').nth(1) {
                    if let Ok(port) = u16::from_str_radix(port_hex, 16) {
                        if target_ports.contains(&port) {
                            let remote_ip = if let Some(ip_hex) = rem_addr.split(':').next() {
                                if is_ipv6 {
                                    hex_to_ipv6(ip_hex)
                                } else {
                                    hex_to_ipv4(ip_hex)
                                }
                            } else {
                                None
                            };

                            let entry = port_map.entry(port).or_insert_with(|| (0, HashSet::new()));
                            entry.0 += 1;
                            if let Some(ip) = remote_ip {
                                entry.1.insert(ip);
                            }
                        }
                    }
                }
            }
        }
    }
}

fn get_unique_connections_for_ports(target_ports: &[u16]) -> ConnectionMetrics {
    if target_ports.is_empty() {
        return ConnectionMetrics::default();
    }

    let mut port_map: HashMap<u16, (usize, HashSet<String>)> = HashMap::new();

    parse_proc_net_tcp_file("/proc/net/tcp", false, target_ports, &mut port_map);
    parse_proc_net_tcp_file("/proc/net/tcp6", true, target_ports, &mut port_map);

    let mut total_connections = 0;
    let mut all_unique_ips = HashSet::new();
    let mut ports_stats = Vec::new();

    for &port in target_ports {
        if let Some((t_conn, ips_set)) = port_map.get(&port) {
            total_connections += t_conn;
            for ip in ips_set {
                all_unique_ips.insert(ip.clone());
            }

            let mut ip_list: Vec<String> = ips_set.iter().cloned().collect();
            ip_list.sort();
            ip_list.truncate(100);

            ports_stats.push(PortConnectionStats {
                port,
                total_connections: *t_conn,
                unique_connections: ips_set.len(),
                unique_ips: ip_list,
            });
        } else {
            ports_stats.push(PortConnectionStats {
                port,
                total_connections: 0,
                unique_connections: 0,
                unique_ips: Vec::new(),
            });
        }
    }

    let overall_unique_ips: Vec<String> = all_unique_ips.into_iter().collect();
    let unique_connections = overall_unique_ips.len();

    ConnectionMetrics {
        total_connections,
        unique_connections,
        unique_ips: overall_unique_ips,
        ports_stats,
    }
}

#[derive(Deserialize)]
struct ActionPayload {
    action: String, // "restart" | "stop" | "start"
}

#[tokio::main]
async fn main() {
    let port = env::var("PORT").unwrap_or_else(|_| "6678".to_string());
    let addr = format!("0.0.0.0:{}", port);

    // Initialize Docker client (optional - agent works without Docker)
    let docker = match Docker::connect_with_local_defaults() {
        Ok(d) => {
            // Verify Docker is actually reachable
            match d.ping().await {
                Ok(_) => {
                    println!("[+] Docker daemon detected. Container monitoring enabled.");
                    Some(d)
                }
                Err(_) => {
                    println!("[!] Docker daemon not reachable. Running in system-only mode.");
                    None
                }
            }
        }
        Err(_) => {
            println!("[!] Docker not installed. Running in system-only mode (CPU/RAM/Network/TCP).");
            None
        }
    };

    // Parse MONITOR_PORTS env (default: 80,443)
    let monitor_ports: Vec<u16> = env::var("MONITOR_PORTS")
        .unwrap_or_else(|_| "80,443".to_string())
        .split(',')
        .filter_map(|s| s.trim().parse::<u16>().ok())
        .collect();

    println!("[*] Host monitor ports: {:?}", monitor_ports);

    let state = Arc::new(AppState { docker, monitor_ports });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_headers(Any)
        .allow_methods(Any);

    let app = Router::new()
        .route("/metrics", get(get_metrics))
        .route("/containers/:id/stats", get(get_container_stats))
        .route("/containers/:id/logs", get(get_container_logs))
        .route("/containers/:id/action", post(handle_container_action))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("Game Server Agent is listening on http://{}", addr);
    axum::serve(listener, app).await.unwrap();
}

async fn get_metrics(
    _auth: AuthToken,
    State(state): State<Arc<AppState>>,
) -> Result<Json<MetricsResponse>, StatusCode> {
    // 1. Get Host metrics
    let mut sys = System::new_all();
    sys.refresh_cpu();
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    sys.refresh_cpu();
    sys.refresh_memory();

    let cpu_percent = sys.global_cpu_info().cpu_usage();
    let total_mem = sys.total_memory();
    let used_mem = sys.used_memory();
    
    // sysinfo returns bytes or KB depending on sysinfo version, usually bytes in v0.30
    let total_mb = total_mem / 1024 / 1024;
    let used_mb = used_mem / 1024 / 1024;
    let memory_percent = if total_mem > 0 {
        (used_mem as f32 / total_mem as f32) * 100.0
    } else {
        0.0
    };
    let uptime_seconds = System::uptime();

    let host = HostMetrics {
        cpu_percent,
        memory_total_mb: total_mb,
        memory_used_mb: used_mb,
        memory_percent,
        uptime_seconds,
        total_connections: 0,
        unique_connections: 0,
    };

    // 2. Compute host-level connection metrics for configured ports
    let host_conn = get_unique_connections_for_ports(&state.monitor_ports);
    let host = HostMetrics {
        total_connections: host_conn.total_connections,
        unique_connections: host_conn.unique_connections,
        ..host
    };

    // 2. Get Docker Containers list (if Docker is available)
    let containers = if let Some(docker) = &state.docker {
        let list_options = ListContainersOptions::<String> {
            all: true,
            ..Default::default()
        };

        let containers_raw = docker
            .list_containers(Some(list_options))
            .await
            .unwrap_or_default();

        containers_raw
            .into_iter()
            .map(|c| {
                let mut host_ports = Vec::new();
                if let Some(ports) = &c.ports {
                    for p in ports {
                        if let Some(pub_port) = p.public_port {
                            if !host_ports.contains(&pub_port) {
                                host_ports.push(pub_port);
                            }
                        }
                    }
                }
                let conn_metrics = get_unique_connections_for_ports(&host_ports);
                ContainerInfo {
                    id: c.id.unwrap_or_default(),
                    name: c.names.unwrap_or_default().first().cloned().unwrap_or_else(|| "unknown".to_string()),
                    image: c.image.unwrap_or_default(),
                    status: c.status.unwrap_or_default(),
                    state: c.state.unwrap_or_default(),
                    total_connections: conn_metrics.total_connections,
                    unique_connections: conn_metrics.unique_connections,
                }
            })
            .collect()
    } else {
        Vec::new()
    };

    Ok(Json(MetricsResponse { host, containers }))
}

async fn get_container_stats(
    _auth: AuthToken,
    Path(container_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<ContainerStats>, StatusCode> {
    let docker = state.docker.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;

    // 1. Get container details for ports, IP, Uptime
    let inspect = docker
        .inspect_container(&container_id, None)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let name = inspect.name.unwrap_or_default().replace("/", "");
    let status = inspect
        .state
        .as_ref()
        .and_then(|s| s.status.clone())
        .map(|s| format!("{:?}", s))
        .unwrap_or_else(|| "unknown".to_string());
    
    let ip_address = inspect
        .network_settings
        .as_ref()
        .and_then(|n| n.ip_address.clone())
        .filter(|ip| !ip.is_empty())
        .unwrap_or_else(|| {
            // Check in networks bridge
            inspect
                .network_settings
                .as_ref()
                .and_then(|n| n.networks.as_ref())
                .and_then(|nets| nets.values().next())
                .and_then(|n| n.ip_address.clone())
                .unwrap_or_default()
        });

    let mut ports = Vec::new();
    let mut host_ports = Vec::new();
    if let Some(net_settings) = inspect.network_settings.as_ref() {
        if let Some(ports_map) = net_settings.ports.as_ref() {
            for (port_proto, bindings) in ports_map {
                if let Some(binds) = bindings {
                    for b in binds {
                        if let (Some(host_ip), Some(host_port)) = (&b.host_ip, &b.host_port) {
                            ports.push(format!("{} -> {}:{}", port_proto, host_ip, host_port));
                            if let Ok(hp) = host_port.parse::<u16>() {
                                if !host_ports.contains(&hp) {
                                    host_ports.push(hp);
                                }
                            }
                        }
                    }
                } else {
                    ports.push(port_proto.clone());
                }
            }
        }
    }

    // Uptime calculation
    let mut uptime_seconds = 0;
    if let Some(c_state) = inspect.state.as_ref() {
        if let Some(started_at_str) = &c_state.started_at {
            if let Ok(started_time) = DateTime::parse_from_rfc3339(started_at_str) {
                let diff = Utc::now().signed_duration_since(started_time.with_timezone(&Utc));
                if diff.num_seconds() > 0 {
                    uptime_seconds = diff.num_seconds() as u64;
                }
            }
        }
    }

    // 2. Fetch stats stream (get single snapshot by setting stream = false)
    let stats_options = StatsOptions { stream: false, one_shot: true };
    let mut stats_stream = docker.stats(&container_id, Some(stats_options));

    let mut cpu_percent = 0.0;
    let mut memory_used_bytes = 0;
    let mut memory_limit_bytes = 0;
    let mut memory_percent = 0.0;
    let mut network_rx_bytes = 0;
    let mut network_tx_bytes = 0;
    let mut block_read_bytes = 0;
    let mut block_write_bytes = 0;

    if let Some(Ok(stats)) = stats_stream.next().await {
        // CPU calculation
        let cpu_use = stats.cpu_stats.cpu_usage.total_usage;
        let precpu_use = stats.precpu_stats.cpu_usage.total_usage;
        let system_use = stats.cpu_stats.system_cpu_usage.unwrap_or(0);
        let presystem_use = stats.precpu_stats.system_cpu_usage.unwrap_or(0);

        let cpu_delta = cpu_use as f64 - precpu_use as f64;
        let system_delta = system_use as f64 - presystem_use as f64;

        if system_delta > 0.0 && cpu_delta > 0.0 {
            let num_cpus = stats.cpu_stats.online_cpus.unwrap_or(1) as f64;
            cpu_percent = (cpu_delta / system_delta) * num_cpus * 100.0;
        }

        // Memory
        memory_used_bytes = stats.memory_stats.usage.unwrap_or(0);
        memory_limit_bytes = stats.memory_stats.limit.unwrap_or(0);
        if memory_limit_bytes > 0 {
            memory_percent = (memory_used_bytes as f64 / memory_limit_bytes as f64) * 100.0;
        }

        // Network
        if let Some(networks) = stats.networks {
            for net in networks.values() {
                network_rx_bytes += net.rx_bytes;
                network_tx_bytes += net.tx_bytes;
            }
        }

        // Block I/O
        if let Some(io_service_bytes) = stats.blkio_stats.io_service_bytes_recursive {
            for blk in io_service_bytes {
                match blk.op.to_lowercase().as_str() {
                    "read" => block_read_bytes += blk.value,
                    "write" => block_write_bytes += blk.value,
                    _ => {}
                }
            }
        }
    }

    let conn_metrics = get_unique_connections_for_ports(&host_ports);

    Ok(Json(ContainerStats {
        id: container_id,
        name,
        status,
        cpu_percent,
        memory_used_bytes,
        memory_limit_bytes,
        memory_percent,
        network_rx_bytes,
        network_tx_bytes,
        block_read_bytes,
        block_write_bytes,
        ip_address,
        ports,
        uptime_seconds,
        total_connections: conn_metrics.total_connections,
        unique_connections: conn_metrics.unique_connections,
        ports_stats: conn_metrics.ports_stats,
    }))
}

async fn get_container_logs(
    _auth: AuthToken,
    Path(container_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Result<String, StatusCode> {
    let docker = state.docker.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;

    let logs_options = LogsOptions::<String> {
        stdout: true,
        stderr: true,
        tail: "1000".to_string(),
        ..Default::default()
    };

    let mut log_stream = docker.logs(&container_id, Some(logs_options));
    let mut logs = Vec::new();

    while let Some(Ok(log_output)) = log_stream.next().await {
        match log_output {
            bollard::container::LogOutput::StdOut { message } => {
                logs.push(String::from_utf8_lossy(&message).into_owned());
            }
            bollard::container::LogOutput::StdErr { message } => {
                logs.push(String::from_utf8_lossy(&message).into_owned());
            }
            _ => {}
        }
    }

    Ok(logs.join(""))
}

async fn handle_container_action(
    _auth: AuthToken,
    Path(container_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ActionPayload>,
) -> Result<StatusCode, StatusCode> {
    let docker = state.docker.as_ref().ok_or(StatusCode::SERVICE_UNAVAILABLE)?;

    match payload.action.as_str() {
        "restart" => {
            docker
                .restart_container(&container_id, None)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            Ok(StatusCode::OK)
        }
        "stop" => {
            docker
                .stop_container(&container_id, None)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            Ok(StatusCode::OK)
        }
        "start" => {
            docker
                .start_container(&container_id, None::<bollard::container::StartContainerOptions<String>>)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            Ok(StatusCode::OK)
        }
        _ => Err(StatusCode::BAD_REQUEST),
    }
}
