import React, { useEffect, useState, useRef } from 'react'
import axios from 'axios'
import {
  Server,
  Activity,
  Cpu,
  Database,
  Terminal,
  RefreshCw,
  Play,
  Square,
  Plus,
  Trash2,
  Edit2,
  AlertTriangle,
  Clock,
  Globe,
  Radio,
  FileText,
  X,
  LayoutDashboard,
  ShieldAlert,
  ServerCrash,
  CalendarDays,
  Users,
  Wifi
} from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts'
import { Terminal as XTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const BACKEND_BASE = ''

interface GameServer {
  id: number
  name: string
  agent_url: string
  agent_token: string
  status: string
  ssh_host?: string
  ssh_port?: number
  ssh_user?: string
  ssh_password?: string
}

interface ServerOverview {
  id: number
  name: string
  agent_url: string
  status: string
  latest_cpu: number | null
  latest_mem: number | null
  container_count: number
  running_containers: string[]
}

interface ContainerInfo {
  id: string
  name: string
  image: string
  status: string
  state: string
  total_connections?: number
  unique_connections?: number
}

interface HostHistoryPoint {
  timestamp: string
  host_cpu: number
  host_mem: number
}

interface PortConnectionStats {
  port: number
  total_connections: number
  unique_connections: number
  unique_ips: string[]
}

interface ContainerStats {
  id: string
  name: string
  status: string
  cpu_percent: number
  memory_used_bytes: number
  memory_limit_bytes: number
  memory_percent: number
  network_rx_bytes: number
  network_tx_bytes: number
  block_read_bytes: number
  block_write_bytes: number
  ip_address: string
  ports: string[]
  uptime_seconds: number
  total_connections?: number
  unique_connections?: number
  ports_stats?: PortConnectionStats[]
}

interface SshTab {
  id: string
  serverId: number
  serverName: string
  sshHost: string
  sshPort: number
  sshUser: string
  sshPassword?: string
}

export default function App() {
  const [servers, setServers] = useState<GameServer[]>([])
  const [selectedServer, setSelectedServer] = useState<GameServer | null>(null)
  const [containers, setContainers] = useState<ContainerInfo[]>([])
  const [history, setHistory] = useState<HostHistoryPoint[]>([])
  
  // Navigation
  const [showOverview, setShowOverview] = useState(true)
  const [overviewData, setOverviewData] = useState<ServerOverview[]>([])

  // Date Filter Helpers
  const formatDate = (d: Date) => {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  const getTodayDate = () => formatDate(new Date())

  const getDateDaysAgo = (days: number) => {
    const d = new Date()
    d.setDate(d.getDate() - days)
    return formatDate(d)
  }

  // Quick-select presets
  const hourPresets = [
    { label: '2 giờ', key: '2h', hours: 2 },
    { label: '4 giờ', key: '4h', hours: 4 },
    { label: '8 giờ', key: '8h', hours: 8 },
  ]

  const datePresets = [
    { label: 'Hôm nay', key: 'today', days: 0 },
    { label: '3 ngày', key: '3d', days: 3 },
    { label: '7 ngày', key: '7d', days: 7 },
    { label: '30 ngày', key: '30d', days: 30 },
    { label: '90 ngày', key: '90d', days: 90 },
  ]

  // History date filters state
  const [startDate, setStartDate] = useState(getTodayDate())
  const [endDate, setEndDate] = useState(getTodayDate())
  const [activePreset, setActivePreset] = useState<string>('today')
  const [isFiltering, setIsFiltering] = useState(false)
  
  // Add Server States
  const [showAddModal, setShowAddModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('http://localhost:9100')
  const [newToken, setNewToken] = useState('secret-agent-token-123')

  // Edit Server States
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingServer, setEditingServer] = useState<GameServer | null>(null)
  const [editName, setEditName] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editToken, setEditToken] = useState('')
  
  // Monitoring details modal
  const [selectedContainer, setSelectedContainer] = useState<ContainerInfo | null>(null)
  const [containerStats, setContainerStats] = useState<ContainerStats | null>(null)
  const [containerLogs, setContainerLogs] = useState<string>('')
  const [isPerformingAction, setIsPerformingAction] = useState(false)
  const [logFilter, setLogFilter] = useState('')
  
  // Multi-Tab SSH States
  const [sshTabs, setSshTabs] = useState<SshTab[]>([])
  const [activeSshTabId, setActiveSshTabId] = useState<string | null>(null)

  const handleOpenSshTab = (server: GameServer) => {
    const defaultHost = server.ssh_host || server.agent_url.replace(/^https?:\/\//, '').split(':')[0]
    const newTab: SshTab = {
      id: `ssh-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      serverId: server.id,
      serverName: server.name,
      sshHost: defaultHost,
      sshPort: server.ssh_port || 22,
      sshUser: server.ssh_user || 'root',
      sshPassword: server.ssh_password || ''
    }
    setSshTabs(prev => [...prev, newTab])
    setActiveSshTabId(newTab.id)
  }

  const handleCloseSshTab = (tabId: string) => {
    setSshTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId)
      if (activeSshTabId === tabId) {
        if (filtered.length > 0) {
          setActiveSshTabId(filtered[filtered.length - 1].id)
        } else {
          setActiveSshTabId(null)
        }
      }
      return filtered
    })
  }
  
  const terminalEndRef = useRef<HTMLDivElement>(null)

  // Axios helper
  const api = axios.create({ baseURL: BACKEND_BASE })

  // Fetch servers list
  const fetchServers = async () => {
    try {
      const res = await api.get('/api/servers')
      setServers(res.data)
      
      if (selectedServer) {
        const latestSelected = res.data.find((s: GameServer) => s.id === selectedServer.id)
        if (latestSelected) {
          if (
            latestSelected.status !== selectedServer.status ||
            latestSelected.name !== selectedServer.name ||
            latestSelected.agent_url !== selectedServer.agent_url
          ) {
            setSelectedServer(latestSelected)
          }
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  // Fetch aggregate overview data
  const fetchOverviewData = async () => {
    try {
      const res = await api.get('/api/overview')
      setOverviewData(res.data)
    } catch (e) {
      console.error(e)
    }
  }

  // Fetch containers and history for the active server
  const fetchServerDetails = async (server: GameServer) => {
    try {
      const containersRes = await api.get(`/api/servers/${server.id}/containers`)
      setContainers(containersRes.data)
      
      // Fetch default history (latest 30 points)
      const historyRes = await api.get(`/api/servers/${server.id}/history`)
      setHistory(historyRes.data)
    } catch (e) {
      console.error(e)
    }
  }

  // Fetch specific container details (stats & logs)
  const fetchContainerDetails = async (server: GameServer, container: ContainerInfo) => {
    try {
      const statsRes = await api.get(`/api/servers/${server.id}/containers/${container.id}/stats`)
      setContainerStats(statsRes.data)
      
      const logsRes = await api.get(`/api/servers/${server.id}/containers/${container.id}/logs`)
      setContainerLogs(logsRes.data)
    } catch (e) {
      console.error(e)
    }
  }

  // Load initial data
  useEffect(() => {
    fetchServers()
    fetchOverviewData()
  }, [])

  // Poll server lists, host details and overview status
  useEffect(() => {
    const timer = setInterval(() => {
      fetchServers()
      fetchOverviewData()
      if (selectedServer && !showOverview && !isFiltering) {
        fetchServerDetails(selectedServer)
      }
    }, 5000)
    return () => clearInterval(timer)
  }, [selectedServer, showOverview, isFiltering])

  // Poll container metrics if modal open
  useEffect(() => {
    if (!selectedServer || !selectedContainer) return
    fetchContainerDetails(selectedServer, selectedContainer)

    const timer = setInterval(() => {
      fetchContainerDetails(selectedServer, selectedContainer)
    }, 3000)
    return () => clearInterval(timer)
  }, [selectedServer, selectedContainer])

  // Fetch once immediately when server is switched
  useEffect(() => {
    if (selectedServer) {
      fetchServerDetails(selectedServer)
      setContainers([])
      setHistory([])
      setIsFiltering(false)
      setStartDate(getTodayDate())
      setEndDate(getTodayDate())
    }
  }, [selectedServer])

  // Scroll terminal logs to bottom
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [containerLogs])

  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName || !newUrl) return
    try {
      const res = await api.post('/api/servers', {
        name: newName,
        agent_url: newUrl,
        agent_token: newToken
      })
      setServers([...servers, res.data])
      setSelectedServer(res.data)
      setShowOverview(false)
      setShowAddModal(false)
      setNewName('')
      setNewUrl('http://localhost:9100')
      setNewToken('secret-agent-token-123')
    } catch (e) {
      alert('Không thể kết nối đến Agent. Kiểm tra lại thông số!')
    }
  }

  const handleEditServer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingServer || !editName || !editUrl) return
    try {
      const res = await api.put(`/api/servers/${editingServer.id}`, {
        name: editName,
        agent_url: editUrl,
        agent_token: editToken
      })
      const updated = servers.map(s => s.id === editingServer.id ? res.data : s)
      setServers(updated)
      if (selectedServer?.id === editingServer.id) {
        setSelectedServer(res.data)
      }
      setShowEditModal(false)
      setEditingServer(null)
      fetchOverviewData()
      alert('Cập nhật thông tin Server thành công!')
    } catch (e) {
      alert('Không thể cập nhật server. Kiểm tra lại thông số kết nối!')
    }
  }

  const handleDeleteServer = async (id: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa Server này?')) return
    try {
      await api.delete(`/api/servers/${id}`)
      const remaining = servers.filter(s => s.id !== id)
      setServers(remaining)
      if (selectedServer?.id === id) {
        setSelectedServer(null)
        setShowOverview(true)
      }
      fetchOverviewData()
    } catch (e) {
      console.error(e)
    }
  }

  const handleFilterHistory = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!selectedServer || !startDate || !endDate) return
    setIsFiltering(true)
    try {
      const res = await api.get(`/api/servers/${selectedServer.id}/history`, {
        params: { start_date: startDate, end_date: endDate }
      })
      setHistory(res.data)
    } catch (e) {
      console.error(e)
      alert('Không thể tải dữ liệu lịch sử theo khoảng ngày đã chọn!')
    }
  }

  const handlePresetFilter = async (presetKey: string, days: number) => {
    if (!selectedServer) return
    setActivePreset(presetKey)
    const end = getTodayDate()
    const start = days === 0 ? end : getDateDaysAgo(days)
    setStartDate(start)
    setEndDate(end)

    if (days === 0) {
      // "Hôm nay" = live mode
      setIsFiltering(false)
      fetchServerDetails(selectedServer)
      return
    }

    setIsFiltering(true)
    try {
      const res = await api.get(`/api/servers/${selectedServer.id}/history`, {
        params: { start_date: start, end_date: end }
      })
      setHistory(res.data)
    } catch (e) {
      console.error(e)
    }
  }

  const handleHourFilter = async (presetKey: string, hours: number) => {
    if (!selectedServer) return
    setActivePreset(presetKey)
    setIsFiltering(true)
    try {
      const res = await api.get(`/api/servers/${selectedServer.id}/history`, {
        params: { hours }
      })
      setHistory(res.data)
    } catch (e) {
      console.error(e)
    }
  }

  const handleClearHistoryFilter = () => {
    setStartDate(getTodayDate())
    setEndDate(getTodayDate())
    setIsFiltering(false)
    setActivePreset('today')
    if (selectedServer) {
      fetchServerDetails(selectedServer)
    }
  }

  const handleContainerAction = async (action: 'restart' | 'stop' | 'start') => {
    if (!selectedServer || !selectedContainer) return
    setIsPerformingAction(true)
    try {
      await api.post(`/api/servers/${selectedServer.id}/containers/${selectedContainer.id}/action`, { action })
      alert(`Gửi lệnh ${action} thành công!`)
      fetchContainerDetails(selectedServer, selectedContainer)
    } catch (e) {
      alert(`Thực thi lệnh ${action} thất bại!`)
    } finally {
      setIsPerformingAction(false)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getFilteredLogs = () => {
    if (!logFilter) return containerLogs
    return containerLogs
      .split('\n')
      .filter(line => line.toLowerCase().includes(logFilter.toLowerCase()))
      .join('\n')
  }

  // Calculate Overview Aggregate Metrics
  const totalServers = overviewData.length
  const onlineServers = overviewData.filter(s => s.status === 'online').length
  const offlineServers = totalServers - onlineServers
  const totalContainers = overviewData.reduce((acc, s) => acc + s.container_count, 0)

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      
      {/* 1. Left Sidebar */}
      <aside className="w-80 bg-slate-900 border-r border-slate-800/80 flex flex-col overflow-hidden">
        
        {/* Logo and title */}
        <div className="p-6 border-b border-slate-800/80 bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/10">
              <Activity className="w-5.5 h-5.5 text-white animate-pulse" />
            </div>
            <div>
              <h1 className="text-sm font-extrabold tracking-wider text-slate-100">GAME EXPORTER</h1>
              <p className="text-[10px] text-slate-400 font-semibold uppercase">Management Console</p>
            </div>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="p-1.5 bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white rounded-lg transition-all active:scale-90"
            title="Thêm Server"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* System Overview Selector */}
        <div className="px-4 pt-4">
          <button
            onClick={() => {
              setShowOverview(true)
              setSelectedServer(null)
            }}
            className={`w-full flex items-center gap-3 p-3.5 rounded-xl border text-xs font-semibold tracking-wide transition-all ${
              showOverview
                ? 'bg-blue-600/10 border-blue-500 text-blue-400'
                : 'bg-slate-950/20 border-slate-800/50 hover:bg-slate-800/20 text-slate-300'
            }`}
          >
            <LayoutDashboard className="w-4.5 h-4.5" />
            Tổng quan hệ thống
          </button>
        </div>

        {/* Server List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2">Danh sách Game Server</div>
          {servers.map(s => (
            <div
              key={s.id}
              onClick={() => {
                setSelectedServer(s)
                setShowOverview(false)
              }}
              className={`w-full flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all group ${
                !showOverview && selectedServer?.id === s.id
                  ? 'bg-blue-600/10 border-blue-500 text-blue-400'
                  : 'bg-slate-950/40 border-slate-850 hover:bg-slate-800/30 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Server className={`w-5 h-5 ${!showOverview && selectedServer?.id === s.id ? 'text-blue-400' : 'text-slate-500'}`} />
                <div className="text-left min-w-0">
                  <div className="text-xs font-semibold text-slate-200 truncate">{s.name}</div>
                  <div className="text-[10px] text-slate-500 truncate">{s.agent_url}</div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${
                  s.status === 'online' ? 'bg-green-500 animate-ping' : 'bg-red-500'
                }`} />
                
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingServer(s)
                      setEditName(s.name)
                      setEditUrl(s.agent_url)
                      setEditToken(s.agent_token)
                      setShowEditModal(true)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-blue-400 hover:bg-slate-800/40 rounded transition-all"
                    title="Sửa thông số"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteServer(s.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 hover:bg-slate-800/40 rounded transition-all"
                    title="Xóa Server"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* 2. Main Dashboard Area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-slate-950 p-6 space-y-6">
        
        {showOverview ? (
          /* SYSTEM OVERVIEW SCREEN */
          <div className="flex-1 flex flex-col overflow-y-auto space-y-6">
            
            {/* Overview Header */}
            <div>
              <h2 className="text-xl font-bold tracking-tight">Tổng quan hoạt động hệ thống</h2>
              <p className="text-xs text-slate-400 mt-1">Quản lý và giám sát trạng thái thời gian thực của tất cả các cụm game server.</p>
            </div>

            {/* Aggregated Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              
              {/* Total registered */}
              <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl flex items-center gap-3.5 shadow-md">
                <div className="p-2.5 bg-blue-600/10 text-blue-400 rounded-xl">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Tổng số Server</div>
                  <div className="text-lg font-extrabold text-slate-100 mt-0.5">{totalServers}</div>
                </div>
              </div>

              {/* Online */}
              <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl flex items-center gap-3.5 shadow-md">
                <div className="p-2.5 bg-green-600/10 text-green-400 rounded-xl">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Server Đang Chạy</div>
                  <div className="text-lg font-extrabold text-slate-100 mt-0.5">{onlineServers}</div>
                </div>
              </div>

              {/* Offline */}
              <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl flex items-center gap-3.5 shadow-md">
                <div className="p-2.5 bg-red-600/10 text-red-400 rounded-xl">
                  <ServerCrash className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Server Ngoại Tuyến</div>
                  <div className="text-lg font-extrabold text-slate-100 mt-0.5">{offlineServers}</div>
                </div>
              </div>

              {/* Total Containers */}
              <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl flex items-center gap-3.5 shadow-md">
                <div className="p-2.5 bg-purple-600/10 text-purple-400 rounded-xl">
                  <Radio className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Docker Container</div>
                  <div className="text-lg font-extrabold text-slate-100 mt-0.5">{totalContainers}</div>
                </div>
              </div>

              {/* Unique Clients */}
              <div className="bg-slate-900 border border-slate-800/80 p-4 rounded-2xl flex items-center gap-3.5 shadow-md col-span-2 lg:col-span-1">
                <div className="p-2.5 bg-emerald-600/10 text-emerald-400 rounded-xl">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Unique Clients (IPs)</div>
                  <div className="text-lg font-extrabold text-emerald-400 mt-0.5 font-mono">
                    {containers.reduce((acc, c) => acc + (c.unique_connections || 0), 0)}
                  </div>
                </div>
              </div>

            </div>

            {/* Servers Cards Grid */}
            <div className="space-y-4">
              <div className="text-xs font-bold text-slate-300 uppercase tracking-wider px-1">Trạng thái chi tiết từng cụm</div>
              
              {overviewData.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {overviewData.map(s => (
                    <div
                      key={s.id}
                      className="bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-2xl p-5 shadow-lg flex flex-col justify-between space-y-4 transition-all duration-300 hover:-translate-y-0.5"
                    >
                      {/* Server Card Header */}
                      <div className="flex justify-between items-start">
                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-slate-100 truncate">{s.name}</h4>
                          <span className="text-[10px] text-slate-500 font-mono truncate block mt-0.5">{s.agent_url}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase ${
                          s.status === 'online' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                        }`}>
                          {s.status}
                        </span>
                      </div>

                      {/* Server Card Info Body */}
                      <div className="flex-1">
                        {s.status === 'online' ? (
                          <div className="space-y-3.5">
                            {/* CPU Load bar */}
                            <div className="space-y-1">
                              <div className="flex justify-between text-[11px] font-semibold">
                                <span className="text-slate-400">Tải CPU Host</span>
                                <span className="text-blue-400 font-mono">
                                  {s.latest_cpu !== null ? `${s.latest_cpu.toFixed(1)}%` : 'N/A'}
                                </span>
                              </div>
                              <div className="w-full bg-slate-950 rounded-full h-1.5 border border-slate-850">
                                <div
                                  className="bg-blue-500 h-1.5 rounded-full transition-all"
                                  style={{ width: `${s.latest_cpu !== null ? Math.min(s.latest_cpu, 100) : 0}%` }}
                                />
                              </div>
                            </div>

                            {/* RAM Load bar */}
                            <div className="space-y-1">
                              <div className="flex justify-between text-[11px] font-semibold">
                                <span className="text-slate-400">Bộ nhớ RAM Host</span>
                                <span className="text-purple-400 font-mono">
                                  {s.latest_mem !== null ? `${s.latest_mem.toFixed(1)}%` : 'N/A'}
                                </span>
                              </div>
                              <div className="w-full bg-slate-950 rounded-full h-1.5 border border-slate-850">
                                <div
                                  className="bg-purple-500 h-1.5 rounded-full transition-all"
                                  style={{ width: `${s.latest_mem !== null ? Math.min(s.latest_mem, 100) : 0}%` }}
                                />
                              </div>
                            </div>

                            {/* Containers summary */}
                            <div className="border-t border-slate-800 pt-3 space-y-1.5">
                              <span className="text-[10px] text-slate-400 font-bold uppercase">
                                Containers đang chạy ({s.container_count})
                              </span>
                              <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                                {s.running_containers.length > 0 ? (
                                  s.running_containers.map((name, idx) => (
                                    <span key={idx} className="bg-slate-950 text-slate-300 border border-slate-800 text-[9px] px-1.5 py-0.5 rounded font-mono truncate max-w-[120px]">
                                      {name}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[10px] text-slate-600 font-semibold italic">Không có container nào</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-6 text-center bg-slate-950/20 border border-slate-850 rounded-xl p-3">
                            <ShieldAlert className="w-6 h-6 text-red-500 mb-1.5" />
                            <p className="text-[11px] text-slate-400 leading-relaxed max-w-[200px]">
                              Không thể kết nối đến Agent. Kiểm tra cài đặt dịch vụ.
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Card Button footer */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            const originalServerObj = servers.find(item => item.id === s.id)
                            if (originalServerObj) {
                              setSelectedServer(originalServerObj)
                              setShowOverview(false)
                            }
                          }}
                          className="flex-1 bg-slate-950 hover:bg-blue-600 border border-slate-800 hover:border-blue-500 hover:text-white text-slate-300 font-semibold rounded-xl py-2 text-xs transition-all"
                        >
                          Giám sát chi tiết
                        </button>
                        <button
                          onClick={() => {
                            const originalServerObj = servers.find(item => item.id === s.id)
                            if (originalServerObj) handleOpenSshTab(originalServerObj)
                          }}
                          className="px-3 bg-slate-950 hover:bg-blue-600/20 text-slate-400 hover:text-blue-400 border border-slate-800 hover:border-blue-500/40 rounded-xl text-xs font-semibold transition-all flex items-center gap-1"
                          title="Mở SSH Terminal"
                        >
                          <Terminal className="w-4 h-4" />
                          <span className="hidden sm:inline">SSH</span>
                        </button>
                      </div>

                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 border border-dashed border-slate-850 rounded-3xl bg-slate-900/10 space-y-4">
                  <Server className="w-12 h-12 text-slate-700 mx-auto" />
                  <h4 className="text-sm font-bold text-slate-400">Chưa đăng ký Game Server nào</h4>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-xs font-semibold shadow-md active:scale-95 transition-all"
                  >
                    Thêm Server Game mới
                  </button>
                </div>
              )}
            </div>

          </div>
        ) : selectedServer ? (
          /* SINGLE SERVER DETAILED SCREEN */
          <div className="flex-1 flex flex-col overflow-y-auto space-y-6 pr-1">
            
            {/* Header Server title */}
            <div className="flex justify-between items-center bg-slate-900 border border-slate-800/80 rounded-2xl p-5 shadow-lg flex-shrink-0">
              <div className="flex items-center gap-4">
                <div className={`p-3.5 rounded-xl ${selectedServer.status === 'online' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                  <Globe className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">{selectedServer.name}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Agent URL: <span className="font-mono text-blue-400">{selectedServer.agent_url}</span></p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  selectedServer.status === 'online' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                }`}>
                  {selectedServer.status === 'online' ? 'ONLINE' : 'OFFLINE'}
                </span>
                
                <button
                  onClick={() => handleOpenSshTab(selectedServer)}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/20 rounded-xl text-xs font-bold transition-all active:scale-95"
                  title="Mở SSH Terminal"
                >
                  <Terminal className="w-4 h-4" />
                  <span>SSH Terminal</span>
                </button>

                <button
                  onClick={() => {
                    setEditingServer(selectedServer)
                    setEditName(selectedServer.name)
                    setEditUrl(selectedServer.agent_url)
                    setEditToken(selectedServer.agent_token)
                    setShowEditModal(true)
                  }}
                  className="p-2.5 bg-slate-800/50 hover:bg-slate-700/50 text-slate-400 hover:text-blue-400 border border-slate-800/40 rounded-xl transition-all"
                  title="Sửa Server"
                >
                  <Edit2 className="w-4 h-4" />
                </button>

                <button
                  onClick={() => handleDeleteServer(selectedServer.id)}
                  className="p-2.5 bg-slate-800/50 hover:bg-red-950/30 text-slate-400 hover:text-red-400 border border-slate-800/40 rounded-xl transition-all"
                  title="Xóa Server"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Date Filter Bar */}
            <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 shadow-md flex-shrink-0 space-y-3">
              {/* Row 1: Title + Quick Presets */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-blue-500" />
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Lọc lịch sử tải Host</h3>
                </div>

                <div className="flex items-center gap-1.5">
                  {hourPresets.map(p => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => handleHourFilter(p.key, p.hours)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 ${
                        activePreset === p.key
                          ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
                          : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}

                  <span className="text-slate-700 mx-0.5">|</span>

                  {datePresets.map(p => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => handlePresetFilter(p.key, p.days)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 ${
                        activePreset === p.key
                          ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                          : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 2: Custom Date Range */}
              <form onSubmit={handleFilterHistory} className="flex flex-wrap items-center gap-4 text-xs font-semibold border-t border-slate-800/60 pt-3">
                <div className="flex items-center gap-1.5 text-slate-500">
                  <CalendarDays className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Tùy chỉnh:</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-medium">Từ</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => { setStartDate(e.target.value); setActivePreset('custom') }}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 w-44 font-semibold cursor-pointer hover:border-slate-700 transition-colors"
                    required
                  />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-medium">đến</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => { setEndDate(e.target.value); setActivePreset('custom') }}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 w-44 font-semibold cursor-pointer hover:border-slate-700 transition-colors"
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg px-5 py-2.5 transition-all active:scale-95 shadow-md shadow-blue-500/10"
                >
                  Lọc
                </button>

                {isFiltering && (
                  <button
                    type="button"
                    onClick={handleClearHistoryFilter}
                    className="bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold rounded-lg px-4 py-2.5 transition-all active:scale-95 border border-slate-700/60"
                  >
                    ↻ Live
                  </button>
                )}
              </form>
            </div>

            {/* Host Resource History charts */}
            {history.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-shrink-0">
                
                {/* CPU usage history */}
                <div className="bg-slate-900 border border-slate-800/60 rounded-2xl p-5 shadow-md">
                  <div className="flex items-center gap-2 mb-4">
                    <Cpu className="w-5 h-5 text-blue-500" />
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Lịch sử CPU Server (%)</h3>
                  </div>
                  <div className="h-44 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history}>
                        <defs>
                          <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="timestamp" stroke="#64748b" fontSize={9} />
                        <YAxis stroke="#64748b" fontSize={9} domain={[0, 100]} />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: 8 }} />
                        <Area type="monotone" dataKey="host_cpu" name="CPU Host" stroke="#3b82f6" fillOpacity={1} fill="url(#colorCpu)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Memory usage history */}
                <div className="bg-slate-900 border border-slate-800/60 rounded-2xl p-5 shadow-md">
                  <div className="flex items-center gap-2 mb-4">
                    <Database className="w-5 h-5 text-purple-500" />
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Lịch sử RAM Server (%)</h3>
                  </div>
                  <div className="h-44 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history}>
                        <defs>
                          <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a855f7" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="timestamp" stroke="#64748b" fontSize={9} />
                        <YAxis stroke="#64748b" fontSize={9} domain={[0, 100]} />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: 8 }} />
                        <Area type="monotone" dataKey="host_mem" name="RAM Host" stroke="#a855f7" fillOpacity={1} fill="url(#colorMem)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

              </div>
            ) : (
              <div className="py-12 text-center text-slate-500 font-semibold bg-slate-900 border border-slate-850 rounded-2xl flex-shrink-0">
                Không tìm thấy dữ liệu hoạt động trong khoảng thời gian đã chọn.
              </div>
            )}

            {/* Docker Container List Table */}
            <div className="bg-slate-900 border border-slate-800/60 rounded-2xl p-5 shadow-lg flex-1 min-h-[300px]">
              <div className="flex items-center gap-2.5 mb-4">
                <Radio className="w-5 h-5 text-green-500" />
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Docker Containers trên Server</h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                      <th className="py-3 px-4">Tên Container</th>
                      <th className="py-3 px-4">Docker Image</th>
                      <th className="py-3 px-4">Trạng thái (State)</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-center">Kết nối (Unique / Active)</th>
                      <th className="py-3 px-4 text-center"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {containers.length > 0 ? (
                      containers.map(c => (
                        <tr key={c.id} className="border-b border-slate-850 hover:bg-slate-950/20 transition-all">
                          <td className="py-3.5 px-4 font-semibold text-slate-200">{c.name}</td>
                          <td className="py-3.5 px-4 font-mono text-slate-400 text-[11px] max-w-[200px] truncate" title={c.image}>
                            {c.image}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              c.state === 'running' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                            }`}>
                              {c.state}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px]">{c.status}</td>
                          <td className="py-3.5 px-4 text-center font-mono">
                            <div className="flex items-center justify-center gap-1.5">
                              <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded text-[11px] flex items-center gap-1">
                                <Users className="w-3 h-3 text-emerald-400" />
                                {c.unique_connections ?? 0} IP
                              </span>
                              <span className="text-slate-500 text-[10px]">/</span>
                              <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[11px]">
                                {c.total_connections ?? 0} conns
                              </span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <button
                              onClick={() => {
                                setSelectedContainer(c)
                                setContainerStats(null)
                                setContainerLogs('')
                              }}
                              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg px-3 py-1.5 text-xs transition-all active:scale-95 shadow-md shadow-blue-500/10"
                            >
                              Giám sát chi tiết
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-slate-500 font-semibold">
                          {selectedServer.status === 'online' ? 'Không tìm thấy container nào đang chạy trên máy chủ này.' : 'Vui lòng khởi chạy Agent để tải danh sách container.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-3xl p-12 text-center space-y-4">
            <Activity className="w-16 h-16 text-slate-800 animate-pulse" />
            <h2 className="text-base font-bold text-slate-300">Không có máy chủ hoạt động</h2>
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-5 py-2.5 text-xs font-semibold shadow-lg shadow-blue-500/15 active:scale-95 transition-all"
            >
              Thêm Server đầu tiên
            </button>
          </div>
        )}
      </main>

      {/* 3. Detail Container Monitor Split Screen Modal */}
      {selectedContainer && selectedServer && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-6 z-50 animate-fade-in">
          <div className="w-full max-w-6xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col h-[90vh] space-y-6">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-500/10 rounded-xl flex items-center justify-center text-green-400">
                  <Activity className="w-5.5 h-5.5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100">
                    Giám sát: <span className="text-blue-400 font-mono font-bold">{selectedContainer.name}</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Container ID: <span className="font-mono text-slate-500">{selectedContainer.id.substring(0, 12)}</span></p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                {/* Control Action Buttons */}
                <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
                  <button
                    onClick={() => handleContainerAction('restart')}
                    disabled={isPerformingAction || selectedContainer.state !== 'running'}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs transition-all active:scale-95"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isPerformingAction ? 'animate-spin' : ''}`} />
                    Restart
                  </button>
                  <button
                    onClick={() => handleContainerAction('stop')}
                    disabled={isPerformingAction || selectedContainer.state !== 'running'}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600/10 hover:bg-red-600/20 text-red-500 font-bold text-xs transition-all active:scale-95"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Stop
                  </button>
                  <button
                    onClick={() => handleContainerAction('start')}
                    disabled={isPerformingAction || selectedContainer.state === 'running'}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-green-600/10 hover:bg-green-600/20 text-green-500 font-bold text-xs transition-all active:scale-95"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Start
                  </button>
                </div>

                <button
                  onClick={() => setSelectedContainer(null)}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700/60 rounded-xl transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Split Content view */}
            <div className="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden min-h-0">
              
              {/* Left Side: Live Stats widgets & details */}
              <div className="w-full md:w-1/3 flex flex-col gap-4 overflow-y-auto">
                <div className="bg-slate-950 p-4 border border-slate-850 rounded-2xl space-y-4">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Thông số thời gian thực (Live metrics)</div>
                  
                  {containerStats ? (
                    <div className="space-y-4">
                      {/* CPU usage bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-semibold">
                          <span className="text-slate-400">Container CPU Usage</span>
                          <span className="text-blue-400 font-mono font-bold">{containerStats.cpu_percent.toFixed(2)} %</span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-2">
                          <div
                            className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(containerStats.cpu_percent, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Memory usage bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-semibold">
                          <span className="text-slate-400">Container Memory</span>
                          <span className="text-purple-400 font-mono font-bold">
                            {formatBytes(containerStats.memory_used_bytes)} / {formatBytes(containerStats.memory_limit_bytes)} ({containerStats.memory_percent.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-2">
                          <div
                            className="bg-purple-500 h-2 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(containerStats.memory_percent, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Additional metrics */}
                      <div className="border-t border-slate-850 pt-3.5 space-y-2.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Uptime:</span>
                          <span className="font-mono text-slate-300 font-semibold flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-500" />
                            {Math.floor(containerStats.uptime_seconds / 3600)}h {Math.floor((containerStats.uptime_seconds % 3600) / 60)}m {containerStats.uptime_seconds % 60}s
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Container IP:</span>
                          <span className="font-mono text-slate-300 font-semibold">{containerStats.ip_address || 'None'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Network RX/TX:</span>
                          <span className="font-mono text-slate-300 font-semibold">
                            {formatBytes(containerStats.network_rx_bytes)} / {formatBytes(containerStats.network_tx_bytes)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Disk Read/Write:</span>
                          <span className="font-mono text-slate-300 font-semibold">
                            {formatBytes(containerStats.block_read_bytes)} / {formatBytes(containerStats.block_write_bytes)}
                          </span>
                        </div>
                      </div>

                      {/* Port mapping widget */}
                      <div className="border-t border-slate-850 pt-3.5 space-y-1.5">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Port Mappings</span>
                        <div className="flex flex-wrap gap-1.5">
                          {containerStats.ports.length > 0 ? (
                            containerStats.ports.map((p, idx) => (
                              <span key={idx} className="bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-300 px-2 py-0.5 rounded">
                                {p}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-slate-500 font-semibold">Không có Port Mapping</span>
                          )}
                        </div>
                      </div>

                      {/* TCP Connections & Group by Port Widget */}
                      <div className="border-t border-slate-850 pt-3.5 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Wifi className="w-3.5 h-3.5 text-blue-400" />
                            Kết nối TCP (Group by Port)
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl flex items-center gap-2.5">
                            <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg">
                              <Users className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-[9px] font-bold text-slate-500 uppercase">Unique Clients</div>
                              <div className="text-sm font-extrabold text-slate-100 font-mono">
                                {containerStats.unique_connections ?? 0} <span className="text-[10px] text-slate-500 font-normal">IPs</span>
                              </div>
                            </div>
                          </div>

                          <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl flex items-center gap-2.5">
                            <div className="p-2 bg-green-500/10 text-green-400 rounded-lg">
                              <Activity className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-[9px] font-bold text-slate-500 uppercase">Total Sockets</div>
                              <div className="text-sm font-extrabold text-slate-100 font-mono">
                                {containerStats.total_connections ?? 0} <span className="text-[10px] text-slate-500 font-normal">conns</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Per-port Breakdown */}
                        {containerStats.ports_stats && containerStats.ports_stats.length > 0 && (
                          <div className="space-y-2">
                            {containerStats.ports_stats.map((ps) => (
                              <div key={ps.port} className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-2.5 space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-mono font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded text-[11px]">
                                    Port :{ps.port}
                                  </span>
                                  <div className="flex items-center gap-2 text-[11px] font-mono">
                                    <span className="text-slate-400">
                                      <strong className="text-emerald-400">{ps.unique_connections}</strong> unique IP
                                    </span>
                                    <span className="text-slate-600">•</span>
                                    <span className="text-slate-400">
                                      <strong className="text-slate-200">{ps.total_connections}</strong> sockets
                                    </span>
                                  </div>
                                </div>

                                {ps.unique_ips && ps.unique_ips.length > 0 ? (
                                  <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-850">
                                    {ps.unique_ips.slice(0, 10).map((ip, iidx) => (
                                      <span key={iidx} className="bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-400 px-1.5 py-0.5 rounded" title={ip}>
                                        {ip}
                                      </span>
                                    ))}
                                    {ps.unique_ips.length > 10 && (
                                      <span className="text-[10px] font-mono text-slate-500 px-1 py-0.5">
                                        +{ps.unique_ips.length - 10} IP khác...
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-slate-600 italic">Chưa có kết nối active</div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                    </div>
                  ) : (
                    <div className="py-12 flex flex-col items-center justify-center text-slate-600 text-xs">
                      <RefreshCw className="w-6 h-6 animate-spin mb-2 text-slate-700" />
                      Đang tải tài nguyên...
                    </div>
                  )}
                </div>

                <div className="bg-slate-950 p-4 border border-slate-850 rounded-2xl flex gap-3 text-xs text-slate-400 items-start">
                  <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <span>
                    Các hành động Restart, Stop, Start sẽ tương tác trực tiếp lên dịch vụ Docker của hệ thống. Vui lòng đảm bảo các client khác đã ngắt kết nối an toàn trước khi thực hiện.
                  </span>
                </div>
              </div>

              {/* Right Side: Terminal log stream with search bar */}
              <div className="flex-1 flex flex-col bg-slate-950 border border-slate-850 rounded-2xl overflow-hidden shadow-inner">
                {/* Console Terminal Header */}
                <div className="flex items-center justify-between bg-slate-950 border-b border-slate-850/80 px-4 py-2.5 text-xs text-slate-400 font-semibold">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-blue-500 animate-pulse" />
                    <span>Real-time Log stream</span>
                  </div>
                  
                  {/* Log Filter input */}
                  <input
                    type="text"
                    placeholder="Lọc log..."
                    value={logFilter}
                    onChange={e => setLogFilter(e.target.value)}
                    className="bg-slate-900 border border-slate-800/80 rounded px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500 w-44 font-mono font-normal"
                  />
                </div>

                {/* Terminal Body */}
                <div className="flex-grow p-4 overflow-y-auto font-mono text-[11px] bg-black text-green-400 space-y-1 min-h-0">
                  {getFilteredLogs() ? (
                    <pre className="whitespace-pre-wrap leading-relaxed break-all">
                      {getFilteredLogs()}
                    </pre>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 font-semibold">
                      <FileText className="w-8 h-8 text-slate-800 mb-2" />
                      Không tìm thấy log nào phù hợp.
                    </div>
                  )}
                  <div ref={terminalEndRef} />
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* 4. Add Server Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-600/10 rounded-lg flex items-center justify-center text-blue-400">
                <Plus className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-100">Đăng ký Server Game mới</h3>
            </div>

            <form onSubmit={handleAddServer} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">Tên Server</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Ví dụ: Minecraft Survival Server"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 text-xs font-semibold transition-all"
                  required
                />
              </div>
              
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">Agent URL (IP / Domain)</label>
                <input
                  type="url"
                  value={newUrl}
                  onChange={e => setNewUrl(e.target.value)}
                  placeholder="http://192.168.1.100:9100"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 text-xs font-mono transition-all"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">Mã bảo mật Token (Secret Key)</label>
                <input
                  type="text"
                  value={newToken}
                  onChange={e => setNewToken(e.target.value)}
                  placeholder="secret-agent-token-123"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 text-xs font-mono transition-all"
                  required
                />
              </div>

              <div className="flex gap-3 justify-end pt-2 text-xs">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-lg px-4 py-2 transition-all active:scale-95"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg px-4 py-2 transition-all active:scale-95 shadow-lg shadow-blue-500/10"
                >
                  Kết nối & Lưu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Edit Server Modal */}
      {showEditModal && editingServer && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-600/10 rounded-lg flex items-center justify-center text-blue-400">
                <Edit2 className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-100">Chỉnh sửa Server Game</h3>
            </div>

            <form onSubmit={handleEditServer} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">Tên Server</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="Ví dụ: Minecraft Survival Server"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 text-xs font-semibold transition-all"
                  required
                />
              </div>
              
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">Agent URL (IP / Domain)</label>
                <input
                  type="url"
                  value={editUrl}
                  onChange={e => setEditUrl(e.target.value)}
                  placeholder="http://192.168.1.100:9100"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 text-xs font-mono transition-all"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">Mã bảo mật Token (Secret Key)</label>
                <input
                  type="text"
                  value={editToken}
                  onChange={e => setEditToken(e.target.value)}
                  placeholder="secret-agent-token-123"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 text-xs font-mono transition-all"
                  required
                />
              </div>

              <div className="flex gap-3 justify-end pt-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false)
                    setEditingServer(null)
                  }}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-lg px-4 py-2 transition-all active:scale-95"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg px-4 py-2 transition-all active:scale-95 shadow-lg shadow-blue-500/10"
                >
                  Cập nhật & Lưu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Multi-Tab SSH Terminal Modal */}
      {sshTabs.length > 0 && (
        <SshMultiTabModal
          tabs={sshTabs}
          activeTabId={activeSshTabId}
          servers={servers}
          onSelectTab={(id) => setActiveSshTabId(id)}
          onCloseTab={(id) => handleCloseSshTab(id)}
          onCloseAll={() => setSshTabs([])}
          onOpenTab={(server) => handleOpenSshTab(server)}
        />
      )}

    </div>
  )
}

function SshMultiTabModal({
  tabs,
  activeTabId,
  servers,
  onSelectTab,
  onCloseTab,
  onCloseAll,
  onOpenTab,
}: {
  tabs: SshTab[]
  activeTabId: string | null
  servers: GameServer[]
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onCloseAll: () => void
  onOpenTab: (server: GameServer) => void
}) {
  const [showAddTabMenu, setShowAddTabMenu] = useState(false)

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 md:p-6 z-50 animate-fade-in">
      <div className="w-full max-w-6xl bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl flex flex-col h-[88vh] space-y-4">
        
        {/* Top Header & Tab Bar */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3.5 gap-4">
          
          {/* Scrollable Tabs List */}
          <div className="flex items-center gap-2 overflow-x-auto flex-1 py-1 pr-2 min-w-0">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId
              return (
                <div
                  key={tab.id}
                  onClick={() => onSelectTab(tab.id)}
                  className={`flex items-center gap-2.5 px-3.5 py-2 rounded-xl border text-xs font-mono font-bold cursor-pointer transition-all flex-shrink-0 group ${
                    isActive
                      ? 'bg-blue-600/15 border-blue-500 text-blue-400 shadow-md shadow-blue-500/10'
                      : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                  }`}
                >
                  <Terminal className={`w-3.5 h-3.5 ${isActive ? 'text-blue-400' : 'text-slate-500'}`} />
                  <span className="truncate max-w-[130px]">{tab.serverName}</span>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onCloseTab(tab.id)
                    }}
                    className="p-1 hover:bg-slate-700/60 text-slate-500 hover:text-red-400 rounded-lg transition-colors"
                    title="Đóng Tab SSH"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )
            })}

            {/* New Tab Button */}
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setShowAddTabMenu(!showAddTabMenu)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold border border-slate-700/60 rounded-xl text-xs transition-all active:scale-95"
                title="Mở Tab SSH mới"
              >
                <Plus className="w-3.5 h-3.5 text-blue-400" />
                <span>Tab mới</span>
              </button>

              {/* Server Picker Dropdown */}
              {showAddTabMenu && (
                <div className="absolute top-full left-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl z-50 p-2 space-y-1">
                  <div className="text-[10px] font-bold text-slate-500 uppercase px-2 py-1">Chọn Server kết nối:</div>
                  {servers.length > 0 ? (
                    servers.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          onOpenTab(s)
                          setShowAddTabMenu(false)
                        }}
                        className="w-full text-left flex items-center justify-between px-3 py-2 hover:bg-blue-600/10 rounded-xl text-xs font-semibold text-slate-200 hover:text-blue-400 transition-colors"
                      >
                        <span className="truncate">{s.name}</span>
                        <span className="text-[10px] font-mono text-slate-500 truncate max-w-[80px]">{s.agent_url}</span>
                      </button>
                    ))
                  ) : (
                    <div className="text-xs text-slate-500 px-2 py-2">Chưa có server nào</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Close Modal Button */}
          <button
            onClick={onCloseAll}
            className="p-2 bg-slate-800 hover:bg-red-600/20 text-slate-400 hover:text-red-400 border border-slate-700/60 rounded-xl transition-all flex-shrink-0"
            title="Đóng tất cả các Tab"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* SSH Terminals Container Body */}
        <div className="flex-1 overflow-hidden relative">
          {tabs.map((tab) => (
            <SshSingleTabSession
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
            />
          ))}
        </div>

      </div>
    </div>
  )
}

function SshSingleTabSession({
  tab,
  isActive,
}: {
  tab: SshTab
  isActive: boolean
}) {
  const [host, setHost] = useState(tab.sshHost)
  const [port, setPort] = useState(tab.sshPort)
  const [user, setUser] = useState(tab.sshUser)
  const [password, setPassword] = useState(tab.sshPassword || '')

  const [isConnected, setIsConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const termRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const xtermRef = useRef<XTerminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  const handleConnect = () => {
    if (!termRef.current) return
    setConnecting(true)

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const hostHeader = window.location.host
    const wsUrl = `${wsProtocol}//${hostHeader}/api/servers/${tab.serverId}/ssh/ws?ssh_host=${encodeURIComponent(host)}&ssh_port=${port}&ssh_user=${encodeURIComponent(user)}&ssh_password=${encodeURIComponent(password)}`

    const ws = new WebSocket(wsUrl)
    socketRef.current = ws

    const term = new XTerminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#090d16',
        foreground: '#38bdf8',
        cursor: '#38bdf8',
        selectionBackground: '#1e293b'
      }
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    termRef.current.innerHTML = ''
    term.open(termRef.current)
    fitAddon.fit()
    xtermRef.current = term

    ws.onopen = () => {
      setIsConnected(true)
      setConnecting(false)
      term.writeln('\x1b[1;32m[+] Đã kết nối WebSocket SSH thành công!\x1b[0m\r\n')
    }

    ws.onmessage = (event) => {
      term.write(event.data)
    }

    ws.onerror = () => {
      setConnecting(false)
      term.writeln('\r\n\x1b[1;31m[-] Lỗi kết nối WebSocket SSH!\x1b[0m')
    }

    ws.onclose = () => {
      setIsConnected(false)
      setConnecting(false)
      term.writeln('\r\n\x1b[1;33m[*] Đã ngắt kết nối SSH.\x1b[0m')
    }

    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })
  }

  const handleDisconnect = () => {
    if (socketRef.current) {
      socketRef.current.close()
    }
    setIsConnected(false)
  }

  // Auto connect when tab mounts
  useEffect(() => {
    handleConnect()
    return () => {
      if (socketRef.current) {
        socketRef.current.close()
      }
      if (xtermRef.current) {
        xtermRef.current.dispose()
      }
    }
  }, [])

  // Refit xterm when tab becomes active
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      const timer = setTimeout(() => {
        fitAddonRef.current?.fit()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isActive])

  return (
    <div
      style={{ display: isActive ? 'flex' : 'none' }}
      className="flex-col h-full space-y-3.5"
    >
      {/* Session Controls Header */}
      <div className="bg-slate-950 p-3 border border-slate-850 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-3 font-semibold">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Host:</span>
            <input
              type="text"
              value={host}
              onChange={e => setHost(e.target.value)}
              disabled={isConnected}
              className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 font-mono focus:outline-none focus:border-blue-500 w-32 disabled:opacity-60"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Port:</span>
            <input
              type="number"
              value={port}
              onChange={e => setPort(Number(e.target.value))}
              disabled={isConnected}
              className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 font-mono focus:outline-none focus:border-blue-500 w-16 disabled:opacity-60"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">User:</span>
            <input
              type="text"
              value={user}
              onChange={e => setUser(e.target.value)}
              disabled={isConnected}
              className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 font-mono focus:outline-none focus:border-blue-500 w-24 disabled:opacity-60"
            />
          </div>
          {!isConnected && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Password:</span>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mật khẩu SSH..."
                className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 font-mono focus:outline-none focus:border-blue-500 w-36"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isConnected ? (
            <button
              onClick={handleDisconnect}
              className="bg-red-600/10 hover:bg-red-600/20 text-red-400 font-bold px-3.5 py-1.5 rounded-xl text-xs transition-all border border-red-500/20 active:scale-95"
            >
              Ngắt kết nối
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold px-3.5 py-1.5 rounded-xl text-xs transition-all shadow-md shadow-blue-500/20 active:scale-95"
            >
              {connecting ? 'Đang kết nối...' : 'Kết nối SSH'}
            </button>
          )}
        </div>
      </div>

      {/* XTerm Container */}
      <div className="flex-1 bg-black border border-slate-800 rounded-2xl p-4 overflow-hidden relative shadow-inner">
        <div ref={termRef} className="w-full h-full" />
      </div>
    </div>
  )
}
