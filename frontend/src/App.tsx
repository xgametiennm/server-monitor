import React, { useEffect, useState, useRef, useContext, createContext, useMemo } from 'react'
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
  ServerCrash,
  CalendarDays,
  Users,
  Wifi,
  Sun,
  Moon,
  Loader2,
  ChevronRight
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

/* ---------------------------------------------------------------------------
 * Theme (light / dark) — default dark
 * ------------------------------------------------------------------------ */

type ThemeMode = 'light' | 'dark'

const ThemeContext = createContext<{ theme: ThemeMode; toggle: () => void }>({
  theme: 'dark',
  toggle: () => {}
})

const useTheme = () => useContext(ThemeContext)

const readStoredTheme = (): ThemeMode => {
  try {
    const saved = localStorage.getItem('gsm-theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* ignore */
  }
  return 'dark'
}

/* Shared surface / control recipes ---------------------------------------- */

const CARD = 'rounded-ios-lg bg-surface border border-line shadow-e2'
const INSET = 'rounded-ios bg-surface-2 border border-line'
const FIELD =
  'w-full bg-surface-2 border border-line rounded-ios-sm px-3.5 py-2.5 text-ink placeholder:text-ink-3 ' +
  'focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 transition-all'
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 bg-accent text-accent-ink font-semibold rounded-ios-sm ' +
  'px-4 py-2.5 shadow-e1 transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-50'
const BTN_QUIET =
  'inline-flex items-center justify-center gap-2 bg-surface-2 border border-line text-ink font-semibold ' +
  'rounded-ios-sm px-4 py-2.5 transition-all hover:bg-surface-3 active:scale-[0.97]'
const ICON_BTN =
  'inline-flex items-center justify-center p-2 rounded-ios-sm bg-surface-2 border border-line text-ink-2 ' +
  'transition-all hover:text-ink hover:bg-surface-3 active:scale-95'
/* Compact control pair — identical 34px box so text buttons and icon buttons
   line up perfectly when sitting side by side in a toolbar. */
const BTN_QUIET_SM =
  'inline-flex items-center justify-center h-[34px] px-3 bg-surface-2 border border-line text-ink ' +
  'text-[13px] font-semibold rounded-ios-sm transition-all hover:bg-surface-3 active:scale-[0.97]'
const ICON_BTN_SM =
  'inline-flex items-center justify-center h-[34px] w-[34px] rounded-ios-sm bg-surface-2 border border-line ' +
  'text-ink-2 transition-all hover:text-ink hover:bg-surface-3 active:scale-95'
const LABEL = 'text-[11px] font-semibold uppercase tracking-wide text-ink-2'
const SECTION_TITLE = 'text-[13px] font-semibold text-ink'

interface GameServer {
  id: number
  name: string
  agent_url: string
  agent_token: string
  status: string
  status_reason?: string
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
  status_reason?: string
  latest_cpu: number | null
  latest_mem: number | null
  container_count: number
  running_containers: string[]
  host_total_connections?: number
  host_unique_connections?: number
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
  total_connections?: number
  unique_connections?: number
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

/* Small presentational primitives ---------------------------------------- */

function StatusPill({ online, children }: { online: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
        online ? 'bg-ok/12 text-ok' : 'bg-bad/12 text-bad'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-ok' : 'bg-bad'}`} />
      {children}
    </span>
  )
}

function Meter({ value, tone }: { value: number; tone: string }) {
  return (
    <div className="w-full bg-surface-3 rounded-full h-1.5 overflow-hidden">
      <div
        className="h-1.5 rounded-full transition-all duration-500"
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%`, backgroundColor: tone }}
      />
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  tone,
  className = ''
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  tone: string
  className?: string
}) {
  return (
    <div className={`${CARD} p-4 flex items-center gap-3.5 ${className}`}>
      <div
        className="p-2.5 rounded-ios flex items-center justify-center"
        style={{ backgroundColor: `color-mix(in srgb, ${tone} 12%, transparent)`, color: tone }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-ink-2 truncate">{label}</div>
        <div className="text-[19px] font-semibold text-ink tracking-tight mt-0.5 tabular-nums">{value}</div>
      </div>
    </div>
  )
}

export default function App() {
  /* Theme ---------------------------------------------------------------- */
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem('gsm-theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  const themeCtx = useMemo(
    () => ({ theme, toggle: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')) }),
    [theme]
  )

  const isDark = theme === 'dark'
  const chart = isDark
    ? { accent: '#0a84ff', alt: '#bf5af2', ok: '#30d158', info: '#64d2ff', grid: '#303032', axis: '#78787e', tipBg: '#1c1c1e', tipLine: '#3a3a3c', tipInk: '#f2f2f7' }
    : { accent: '#007aff', alt: '#7d3ac1', ok: '#248a3d', info: '#0071a4', grid: '#e3e3e8', axis: '#9a9aa0', tipBg: '#ffffff', tipLine: '#e3e3e8', tipInk: '#1c1c1e' }

  const tooltipStyle = {
    backgroundColor: chart.tipBg,
    borderColor: chart.tipLine,
    borderRadius: 12,
    fontSize: 12,
    color: chart.tipInk,
    boxShadow: '0 10px 30px -14px rgba(0,0,0,.4)'
  }

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
  // Drives the visible "đang tải" state on the history filter bar + charts.
  const [historyLoading, setHistoryLoading] = useState(false)
  // Manual refresh state for the container table (auto-poll is every 5s).
  const [containersRefreshing, setContainersRefreshing] = useState(false)

  // Add Server States
  const [showAddModal, setShowAddModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('http://localhost:6678')
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
      setNewUrl('http://localhost:6678')
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
    setHistoryLoading(true)
    try {
      const res = await api.get(`/api/servers/${selectedServer.id}/history`, {
        params: { start_date: startDate, end_date: endDate }
      })
      setHistory(res.data)
    } catch (e) {
      console.error(e)
      alert('Không thể tải dữ liệu lịch sử theo khoảng ngày đã chọn!')
    } finally {
      setHistoryLoading(false)
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
      setHistoryLoading(true)
      try {
        await fetchServerDetails(selectedServer)
      } finally {
        setHistoryLoading(false)
      }
      return
    }

    setIsFiltering(true)
    setHistoryLoading(true)
    try {
      const res = await api.get(`/api/servers/${selectedServer.id}/history`, {
        params: { start_date: start, end_date: end }
      })
      setHistory(res.data)
    } catch (e) {
      console.error(e)
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleHourFilter = async (presetKey: string, hours: number) => {
    if (!selectedServer) return
    setActivePreset(presetKey)
    setIsFiltering(true)
    setHistoryLoading(true)
    try {
      const res = await api.get(`/api/servers/${selectedServer.id}/history`, {
        params: { hours }
      })
      setHistory(res.data)
    } catch (e) {
      console.error(e)
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleClearHistoryFilter = async () => {
    setStartDate(getTodayDate())
    setEndDate(getTodayDate())
    setIsFiltering(false)
    setActivePreset('today')
    if (selectedServer) {
      setHistoryLoading(true)
      try {
        await fetchServerDetails(selectedServer)
      } finally {
        setHistoryLoading(false)
      }
    }
  }

  // Manual container refresh — re-reads the container list (and host status)
  // without touching the history filter currently applied to the charts.
  const handleRefreshContainers = async () => {
    if (!selectedServer || containersRefreshing) return
    setContainersRefreshing(true)
    try {
      const res = await api.get(`/api/servers/${selectedServer.id}/containers`)
      setContainers(res.data)
      await fetchServers()
    } catch (e) {
      console.error(e)
    } finally {
      setContainersRefreshing(false)
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

  /* Y-axis auto-scaling ---------------------------------------------------
   * Fixed domains ([0,100] for %, auto for connections) waste most of the
   * plot area when the real values sit in a narrow band. Instead of only
   * handing Recharts an upper bound (its default tickCount then divides the
   * range into fractions that `allowDecimals={false}` rounds into an uneven,
   * duplicate-collapsing set like 0/2/4/5), we compute a whole-number step
   * and emit the tick array explicitly so every gap is identical.
   * Floor stays at 0 so the filled area keeps its baseline meaning.       */
  const niceAxis = (max: number, cap?: number) => {
    // Aim for 4-6 gaps; step must be a whole number so ticks never repeat.
    const target = 5
    const raw = Math.max(max, 1) / target
    const exp = Math.floor(Math.log10(raw))
    const pow = Math.max(1, Math.pow(10, exp))
    const frac = raw / pow
    const mult = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10
    const step = Math.max(1, mult * pow)

    let top = Math.ceil(Math.max(max, 1) / step) * step
    if (cap !== undefined && top > cap) top = cap

    const ticks: number[] = []
    for (let t = 0; t <= top + 1e-9; t += step) ticks.push(Math.round(t))
    // Cap can land between steps (e.g. 100 with step 30) — keep the endpoint.
    if (ticks[ticks.length - 1] !== top) ticks.push(top)

    return { domain: [0, top] as [number, number], ticks }
  }

  const maxOf = (keys: (keyof HostHistoryPoint)[]) =>
    history.reduce(
      (acc, p) => keys.reduce((m, k) => Math.max(m, Number(p[k]) || 0), acc),
      0
    )

  // 15% headroom so the peak never touches the top edge of the plot.
  const cpuAxis = useMemo(() => niceAxis(maxOf(['host_cpu']) * 1.15, 100), [history])
  const memAxis = useMemo(() => niceAxis(maxOf(['host_mem']) * 1.15, 100), [history])
  const connAxis = useMemo(
    () => niceAxis(maxOf(['unique_connections', 'total_connections']) * 1.15),
    [history]
  )

  // Calculate Overview Aggregate Metrics
  const totalServers = overviewData.length
  const onlineServers = overviewData.filter(s => s.status === 'online').length
  const offlineServers = totalServers - onlineServers
  const totalContainers = overviewData.reduce((acc, s) => acc + s.container_count, 0)

  // Segmented control pill. The active state uses the solid accent fill so it
  // reads clearly in both themes (the previous surface+shadow variant was faint).
  const segBtn = (active: boolean) =>
    `h-[28px] px-3 rounded-ios-xs text-[12px] font-semibold transition-all active:scale-[0.97] ${
      active
        ? 'bg-accent text-accent-ink shadow-e1'
        : 'text-ink-2 hover:text-ink hover:bg-surface-3'
    }`

  return (
    <ThemeContext.Provider value={themeCtx}>
    <div className="flex h-screen w-screen bg-canvas text-ink overflow-hidden font-sans antialiased">

      {/* 1. Left Sidebar */}
      <aside className="w-[288px] flex-shrink-0 material border-r border-line flex flex-col overflow-hidden">

        {/* Logo and title */}
        <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-accent rounded-ios flex items-center justify-center shadow-e1 flex-shrink-0">
              <Activity className="w-[18px] h-[18px] text-accent-ink" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[14px] font-semibold tracking-tight text-ink truncate">Game Exporter</h1>
              <p className="text-[11px] text-ink-2 truncate">Management Console</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={themeCtx.toggle}
              className={ICON_BTN}
              title={isDark ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
              aria-label="Đổi giao diện Sáng/Tối"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className={ICON_BTN}
              title="Thêm Server"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* System Overview Selector */}
        <div className="px-3 pt-3">
          <button
            onClick={() => {
              setShowOverview(true)
              setSelectedServer(null)
            }}
            className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-ios text-[13px] font-semibold transition-all ${
              showOverview
                ? 'bg-accent/12 text-accent'
                : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
            }`}
          >
            <LayoutDashboard className="w-[18px] h-[18px]" />
            Tổng quan hệ thống
          </button>
        </div>

        {/* Server List */}
        <div className="flex-1 overflow-y-auto px-3 pb-4 pt-4 space-y-1.5">
          <div className={`${LABEL} px-2 pb-1`}>Danh sách Game Server</div>
          {servers.map(s => {
            const active = !showOverview && selectedServer?.id === s.id
            return (
              <div
                key={s.id}
                onClick={() => {
                  setSelectedServer(s)
                  setShowOverview(false)
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-ios cursor-pointer transition-all group ${
                  active ? 'bg-accent/12' : 'hover:bg-surface-2'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Server className={`w-[18px] h-[18px] flex-shrink-0 ${active ? 'text-accent' : 'text-ink-3'}`} />
                  <div className="text-left min-w-0">
                    <div className={`text-[13px] font-semibold truncate ${active ? 'text-accent' : 'text-ink'}`}>{s.name}</div>
                    <div className="text-[11px] text-ink-3 truncate font-mono">{s.agent_url}</div>
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <span
                    className={`w-2 h-2 rounded-full group-hover:hidden ${s.status === 'online' ? 'bg-ok' : 'bg-bad'}`}
                    title={s.status === 'online' ? 'Online' : 'Offline'}
                  />
                  <div className="hidden group-hover:flex items-center gap-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingServer(s)
                        setEditName(s.name)
                        setEditUrl(s.agent_url)
                        setEditToken(s.agent_token)
                        setShowEditModal(true)
                      }}
                      className="p-1.5 rounded-ios-xs text-ink-3 hover:text-accent hover:bg-surface-3 transition-all"
                      title="Sửa thông số"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteServer(s.id)
                      }}
                      className="p-1.5 rounded-ios-xs text-ink-3 hover:text-bad hover:bg-surface-3 transition-all"
                      title="Xóa Server"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </aside>

      {/* 2. Main Dashboard Area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-canvas p-6 space-y-5">

        {showOverview ? (
          /* SYSTEM OVERVIEW SCREEN */
          <div className="flex-1 flex flex-col overflow-y-auto space-y-5 pr-1">

            {/* Overview Header */}
            <div>
              <h2 className="text-[22px] font-semibold tracking-tight text-ink">Tổng quan hoạt động hệ thống</h2>
              <p className="text-[13px] text-ink-2 mt-1">Quản lý và giám sát trạng thái thời gian thực của tất cả các cụm game server.</p>
            </div>

            {/* Aggregated Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <StatCard
                icon={<Server className="w-[18px] h-[18px]" />}
                label="Tổng số Server"
                value={totalServers}
                tone="var(--c-accent)"
              />
              <StatCard
                icon={<Activity className="w-[18px] h-[18px]" />}
                label="Server đang chạy"
                value={onlineServers}
                tone="var(--c-ok)"
              />
              <StatCard
                icon={<ServerCrash className="w-[18px] h-[18px]" />}
                label="Server ngoại tuyến"
                value={offlineServers}
                tone="var(--c-bad)"
              />
              <StatCard
                icon={<Radio className="w-[18px] h-[18px]" />}
                label="Docker / Dịch vụ Host"
                value={totalContainers > 0 ? totalContainers : overviewData.length}
                tone="var(--c-alt)"
              />
              <StatCard
                icon={<Users className="w-[18px] h-[18px]" />}
                label="Unique Clients (IPs)"
                tone="var(--c-ok)"
                className="col-span-2 lg:col-span-1"
                value={
                  containers.length > 0
                    ? containers.reduce((acc, c) => acc + (c.unique_connections || 0), 0)
                    : overviewData.reduce((acc, s) => acc + (s.host_unique_connections || 0), 0)
                }
              />
            </div>

            {/* Servers Cards Grid */}
            <div className="space-y-3">
              <div className={`${LABEL} px-1`}>Trạng thái chi tiết từng cụm</div>

              {overviewData.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {overviewData.map(s => (
                    <div
                      key={s.id}
                      className={`${CARD} p-5 flex flex-col justify-between gap-4 transition-all duration-300 hover:shadow-e3 hover:-translate-y-0.5`}
                    >
                      {/* Server Card Header */}
                      <div className="flex justify-between items-start gap-3">
                        <div className="min-w-0">
                          <h4 className="text-[15px] font-semibold text-ink truncate">{s.name}</h4>
                          <span className="text-[11px] text-ink-3 font-mono truncate block mt-0.5">{s.agent_url}</span>
                        </div>
                        <StatusPill online={s.status === 'online'}>
                          {s.status === 'online' ? 'Online' : 'Offline'}
                        </StatusPill>
                      </div>

                      {/* Server Card Info Body */}
                      <div className="flex-1">
                        {s.status === 'online' ? (
                          <div className="space-y-3.5">
                            {/* CPU Load bar */}
                            <div className="space-y-1.5">
                              <div className="flex justify-between text-[12px]">
                                <span className="text-ink-2">Tải CPU Host</span>
                                <span className="text-ink font-semibold font-mono tabular-nums">
                                  {s.latest_cpu !== null ? `${s.latest_cpu.toFixed(1)}%` : 'N/A'}
                                </span>
                              </div>
                              <Meter value={s.latest_cpu ?? 0} tone="var(--c-accent)" />
                            </div>

                            {/* RAM Load bar */}
                            <div className="space-y-1.5">
                              <div className="flex justify-between text-[12px]">
                                <span className="text-ink-2">Bộ nhớ RAM Host</span>
                                <span className="text-ink font-semibold font-mono tabular-nums">
                                  {s.latest_mem !== null ? `${s.latest_mem.toFixed(1)}%` : 'N/A'}
                                </span>
                              </div>
                              <Meter value={s.latest_mem ?? 0} tone="var(--c-alt)" />
                            </div>

                            {/* Containers & Host Connections summary */}
                            <div className="border-t border-line pt-3 space-y-2">
                              <div className="flex justify-between items-center gap-2">
                                <span className="text-[11px] text-ink-2 font-medium">
                                  {s.container_count > 0 ? `Containers (${s.container_count})` : 'Kết nối Dịch vụ Host'}
                                </span>
                                {s.host_unique_connections !== undefined && s.host_unique_connections !== null && (
                                  <span className="text-[11px] font-mono font-semibold text-ok tabular-nums">
                                    {s.host_unique_connections} IP active
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto">
                                {s.running_containers.length > 0 ? (
                                  s.running_containers.map((name, idx) => (
                                    <span key={idx} className="bg-surface-2 text-ink-2 border border-line text-[11px] px-2 py-0.5 rounded-ios-xs font-mono truncate max-w-[130px]">
                                      {name}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[11px] text-ink-3 font-mono">
                                    Giám sát Host ({s.host_unique_connections ?? 0} Unique IPs / {s.host_total_connections ?? 0} conns)
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-ios bg-bad/8 border border-bad/20 p-3.5 space-y-2">
                            <div className="flex items-center gap-2 text-bad font-semibold text-[13px]">
                              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                              <span>Kết nối Agent thất bại</span>
                            </div>
                            <p className="text-[11px] text-ink-2 leading-relaxed font-mono break-words">
                              {s.status_reason || 'Không thể kết nối đến Agent. Kiểm tra cài đặt dịch vụ và IP/Port.'}
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
                          className={`${BTN_QUIET} flex-1 text-[13px] py-2`}
                        >
                          Giám sát chi tiết
                        </button>
                        <button
                          onClick={() => {
                            const originalServerObj = servers.find(item => item.id === s.id)
                            if (originalServerObj) handleOpenSshTab(originalServerObj)
                          }}
                          className={`${BTN_QUIET} text-[13px] py-2 px-3`}
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
                <div className={`${CARD} text-center py-16 space-y-4`}>
                  <Server className="w-10 h-10 text-ink-3 mx-auto" />
                  <h4 className="text-[15px] font-semibold text-ink">Chưa đăng ký Game Server nào</h4>
                  <div>
                    <button onClick={() => setShowAddModal(true)} className={BTN_PRIMARY}>
                      <Plus className="w-4 h-4" />
                      Thêm Server Game mới
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        ) : selectedServer ? (
          /* SINGLE SERVER DETAILED SCREEN */
          <div className="flex-1 flex flex-col overflow-y-auto space-y-5 pr-1">

            {/* Header Server title */}
            <div className={`${CARD} flex flex-wrap justify-between items-center gap-4 p-5 flex-shrink-0`}>
              <div className="flex items-center gap-4 min-w-0">
                <div
                  className="p-3 rounded-ios flex items-center justify-center"
                  style={{
                    backgroundColor: selectedServer.status === 'online'
                      ? 'color-mix(in srgb, var(--c-ok) 12%, transparent)'
                      : 'color-mix(in srgb, var(--c-bad) 12%, transparent)',
                    color: selectedServer.status === 'online' ? 'var(--c-ok)' : 'var(--c-bad)'
                  }}
                >
                  <Globe className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[18px] font-semibold tracking-tight text-ink truncate">{selectedServer.name}</h2>
                  <p className="text-[12px] text-ink-2 mt-0.5 truncate">
                    Agent URL: <span className="font-mono text-accent">{selectedServer.agent_url}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <StatusPill online={selectedServer.status === 'online'}>
                  {selectedServer.status === 'online' ? 'Online' : 'Offline'}
                </StatusPill>

                <div className="w-px h-6 bg-line mx-0.5" />

                <button
                  onClick={() => handleOpenSshTab(selectedServer)}
                  className={`${BTN_QUIET_SM} gap-1.5`}
                  title="Mở SSH Terminal"
                >
                  <Terminal className="w-[15px] h-[15px]" />
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
                  className={ICON_BTN_SM}
                  title="Sửa Server"
                >
                  <Edit2 className="w-[15px] h-[15px]" />
                </button>

                <button
                  onClick={() => handleDeleteServer(selectedServer.id)}
                  className={`${ICON_BTN_SM} hover:text-bad`}
                  title="Xóa Server"
                >
                  <Trash2 className="w-[15px] h-[15px]" />
                </button>
              </div>
            </div>

            {/* Offline Alert Banner in Server Detail View */}
            {selectedServer.status !== 'online' && (
              <div className="rounded-ios-lg bg-bad/8 border border-bad/20 p-4 flex items-center gap-3.5 flex-shrink-0">
                <div className="p-2.5 rounded-ios bg-bad/12 text-bad flex-shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-[13px] font-semibold text-bad">Cảnh báo: Agent đang ngoại tuyến (Offline)</h4>
                  <p className="text-[12px] text-ink-2 font-mono mt-0.5 break-words">
                    Nguyên nhân: {overviewData.find(s => s.id === selectedServer.id)?.status_reason || selectedServer.status_reason || 'Agent URL không phản hồi. Kiểm tra lại dịch vụ game-agent và cấu hình IP/Port.'}
                  </p>
                </div>
              </div>
            )}

            {/* Date Filter Bar */}
            <div className={`${CARD} p-4 flex-shrink-0 space-y-3`}>
              {/* Row 1: Title + Quick Presets */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-[18px] h-[18px] text-ink-2" />
                  <h3 className={SECTION_TITLE}>Lọc lịch sử tải Host</h3>
                  {historyLoading ? (
                    <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full bg-accent/12 text-accent text-[11px] font-semibold">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Đang tải...
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full bg-surface-2 border border-line text-ink-2 text-[11px] font-semibold">
                      {history.length} điểm dữ liệu
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="flex items-center gap-1 p-1 rounded-ios bg-surface-2 border border-line">
                    {hourPresets.map(p => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => handleHourFilter(p.key, p.hours)}
                        disabled={historyLoading}
                        className={segBtn(activePreset === p.key)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1 p-1 rounded-ios bg-surface-2 border border-line">
                    {datePresets.map(p => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => handlePresetFilter(p.key, p.days)}
                        disabled={historyLoading}
                        className={segBtn(activePreset === p.key)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Row 2: Custom Date Range */}
              <form onSubmit={handleFilterHistory} className="flex flex-wrap items-center gap-3 text-[12px] border-t border-line pt-3">
                <div className="flex items-center gap-1.5 text-ink-2">
                  <CalendarDays className="w-4 h-4" />
                  <span className="font-medium">Tùy chỉnh</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-ink-2">Từ</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => { setStartDate(e.target.value); setActivePreset('custom') }}
                    className={`${FIELD} w-auto text-[13px] py-2 cursor-pointer`}
                    required
                  />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-ink-2">đến</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => { setEndDate(e.target.value); setActivePreset('custom') }}
                    className={`${FIELD} w-auto text-[13px] py-2 cursor-pointer`}
                    required
                  />
                </div>

                <button type="submit" disabled={historyLoading} className={`${BTN_PRIMARY} text-[13px] py-2 disabled:opacity-50`}>
                  {historyLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Lọc
                </button>

                {isFiltering && (
                  <button
                    type="button"
                    onClick={handleClearHistoryFilter}
                    className={`${BTN_QUIET} text-[13px] py-2`}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Live
                  </button>
                )}
              </form>
            </div>

            {/* Host Resource History charts */}
            {history.length > 0 ? (
              <div
                className={`grid grid-cols-1 xl:grid-cols-3 gap-4 flex-shrink-0 transition-opacity duration-200 ${
                  historyLoading ? 'opacity-40 pointer-events-none' : 'opacity-100'
                }`}
              >

                {/* CPU usage history */}
                <div className={`${CARD} p-5`}>
                  <div className="flex items-center gap-2 mb-4">
                    <Cpu className="w-[18px] h-[18px] text-ink-2" />
                    <h3 className={SECTION_TITLE}>Lịch sử CPU Server (%)</h3>
                  </div>
                  <div className="h-44 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                        <XAxis dataKey="timestamp" stroke={chart.axis} fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis stroke={chart.axis} fontSize={10} domain={cpuAxis.domain} ticks={cpuAxis.ticks} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Area type="monotone" dataKey="host_cpu" name="CPU Host" stroke={chart.accent} fill={chart.accent} fillOpacity={0.1} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Memory usage history */}
                <div className={`${CARD} p-5`}>
                  <div className="flex items-center gap-2 mb-4">
                    <Database className="w-[18px] h-[18px] text-ink-2" />
                    <h3 className={SECTION_TITLE}>Lịch sử RAM Server (%)</h3>
                  </div>
                  <div className="h-44 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                        <XAxis dataKey="timestamp" stroke={chart.axis} fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis stroke={chart.axis} fontSize={10} domain={memAxis.domain} ticks={memAxis.ticks} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Area type="monotone" dataKey="host_mem" name="RAM Host" stroke={chart.alt} fill={chart.alt} fillOpacity={0.1} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Connection usage history */}
                <div className={`${CARD} p-5`}>
                  <div className="flex items-center gap-2 mb-4">
                    <Users className="w-[18px] h-[18px] text-ink-2" />
                    <h3 className={SECTION_TITLE}>Lịch sử Kết nối User (IPs / Sockets)</h3>
                  </div>
                  <div className="h-44 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                        <XAxis dataKey="timestamp" stroke={chart.axis} fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis stroke={chart.axis} fontSize={10} domain={connAxis.domain} ticks={connAxis.ticks} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Area type="monotone" dataKey="unique_connections" name="Unique IPs" stroke={chart.ok} fill={chart.ok} fillOpacity={0.12} strokeWidth={2} />
                        <Area type="monotone" dataKey="total_connections" name="Total Sockets" stroke={chart.info} fill={chart.info} fillOpacity={0.06} strokeWidth={1.5} strokeDasharray="4 4" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

              </div>
            ) : (
              <div className={`${CARD} py-12 text-center text-[13px] text-ink-2 flex-shrink-0`}>
                {historyLoading ? (
                  <span className="inline-flex items-center gap-2 text-ink-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang tải dữ liệu lịch sử...
                  </span>
                ) : (
                  'Không tìm thấy dữ liệu hoạt động trong khoảng thời gian đã chọn.'
                )}
              </div>
            )}

            {/* Containers List OR Non-Docker Host Management Dashboard */}
            {containers.length > 0 ? (
              <div className={`${CARD} p-5 flex-shrink-0`}>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Radio className="w-[18px] h-[18px] text-ink-2" />
                    <h3 className={SECTION_TITLE}>Docker Containers trên Server</h3>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="inline-flex items-center h-[22px] px-2 rounded-full bg-surface-2 border border-line text-ink-2 text-[11px] font-semibold tabular-nums">
                      {containers.length} containers
                    </span>
                    <button
                      onClick={handleRefreshContainers}
                      disabled={containersRefreshing}
                      className={`${BTN_QUIET_SM} gap-1.5 disabled:opacity-55 disabled:cursor-not-allowed`}
                      title="Làm mới danh sách Container"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${containersRefreshing ? 'animate-spin' : ''}`} />
                      {containersRefreshing ? 'Đang tải...' : 'Làm mới'}
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto -mx-1 px-1">
                  <table className="w-full border-collapse text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-line text-ink-2">
                        <th className="py-2.5 px-4 font-medium text-[11px] uppercase tracking-wide">Tên Container</th>
                        <th className="py-2.5 px-4 font-medium text-[11px] uppercase tracking-wide">Docker Image</th>
                        <th className="py-2.5 px-4 font-medium text-[11px] uppercase tracking-wide">Trạng thái (State)</th>
                        <th className="py-2.5 px-4 font-medium text-[11px] uppercase tracking-wide">Status</th>
                        <th className="py-2.5 px-4 font-medium text-[11px] uppercase tracking-wide text-center">Kết nối (Unique / Active)</th>
                        <th className="py-2.5 px-4"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {containers.map(c => (
                        <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface-2 transition-colors">
                          <td className="py-3 px-4 font-semibold text-ink">{c.name}</td>
                          <td className="py-3 px-4 font-mono text-ink-2 text-[12px] max-w-[200px] truncate" title={c.image}>
                            {c.image}
                          </td>
                          <td className="py-3 px-4">
                            <StatusPill online={c.state === 'running'}>{c.state}</StatusPill>
                          </td>
                          <td className="py-3 px-4 text-ink-2 font-mono text-[12px]">{c.status}</td>
                          <td className="py-3 px-4 text-center font-mono">
                            <div className="flex items-center justify-center gap-1.5">
                              <span className="inline-flex items-center gap-1 bg-ok/12 text-ok font-semibold px-2 py-0.5 rounded-ios-xs text-[12px] tabular-nums">
                                <Users className="w-3 h-3" />
                                {c.unique_connections ?? 0} IP
                              </span>
                              <span className="text-ink-3 text-[11px]">/</span>
                              <span className="bg-surface-2 border border-line text-ink-2 px-2 py-0.5 rounded-ios-xs text-[12px] tabular-nums">
                                {c.total_connections ?? 0} conns
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              onClick={() => {
                                setSelectedContainer(c)
                                setContainerStats(null)
                                setContainerLogs('')
                              }}
                              className={`${BTN_QUIET} text-[12px] py-1.5 px-3`}
                            >
                              Giám sát chi tiết
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* Non-Docker Host Management Dashboard */
              <div className={`${CARD} p-6 space-y-5`}>
                {/* Section Banner Header */}
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="p-3 bg-accent/12 text-accent rounded-ios flex-shrink-0">
                      <Server className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[15px] font-semibold text-ink">Bảng Quản trị Hệ thống Host (Non-Docker Server)</h3>
                        <span className="bg-surface-2 border border-line text-ink-2 font-medium px-2 py-0.5 rounded-ios-xs text-[11px]">
                          Native Systemd Agent
                        </span>
                      </div>
                      <p className="text-[12px] text-ink-2 mt-1 leading-relaxed">
                        Máy chủ này đang chạy ứng dụng trực tiếp trên Host OS. Agent thu thập trực tiếp thông số phần cứng &amp; TCP Sockets từ Kernel Linux.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleOpenSshTab(selectedServer)}
                    className={`${BTN_PRIMARY} text-[13px] py-2`}
                  >
                    <Terminal className="w-4 h-4" />
                    Mở Terminal SSH (Host)
                  </button>
                </div>

                {/* Metric Cards Grid for Host */}
                {(() => {
                  const sOverview = overviewData.find(s => s.id === selectedServer.id)
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className={`${INSET} p-4 flex items-center gap-3`}>
                        <div className="p-2.5 bg-accent/12 text-accent rounded-ios-sm">
                          <Cpu className="w-[18px] h-[18px]" />
                        </div>
                        <div>
                          <div className="text-[11px] font-medium text-ink-2">Tải CPU Host</div>
                          <div className="text-[17px] font-semibold text-ink font-mono tabular-nums mt-0.5">
                            {sOverview?.latest_cpu !== null && sOverview?.latest_cpu !== undefined
                              ? `${sOverview.latest_cpu.toFixed(1)}%`
                              : 'N/A'}
                          </div>
                        </div>
                      </div>

                      <div className={`${INSET} p-4 flex items-center gap-3`}>
                        <div className="p-2.5 bg-alt/12 text-alt rounded-ios-sm">
                          <Database className="w-[18px] h-[18px]" />
                        </div>
                        <div>
                          <div className="text-[11px] font-medium text-ink-2">Sử dụng RAM Host</div>
                          <div className="text-[17px] font-semibold text-ink font-mono tabular-nums mt-0.5">
                            {sOverview?.latest_mem !== null && sOverview?.latest_mem !== undefined
                              ? `${sOverview.latest_mem.toFixed(1)}%`
                              : 'N/A'}
                          </div>
                        </div>
                      </div>

                      <div className={`${INSET} p-4 flex items-center gap-3`}>
                        <div className="p-2.5 bg-ok/12 text-ok rounded-ios-sm">
                          <Users className="w-[18px] h-[18px]" />
                        </div>
                        <div>
                          <div className="text-[11px] font-medium text-ink-2">Unique Clients (IPs)</div>
                          <div className="text-[17px] font-semibold text-ink font-mono tabular-nums mt-0.5">
                            {sOverview?.host_unique_connections ?? 0} IP
                          </div>
                        </div>
                      </div>

                      <div className={`${INSET} p-4 flex items-center gap-3`}>
                        <div className="p-2.5 bg-info/12 text-info rounded-ios-sm">
                          <Wifi className="w-[18px] h-[18px]" />
                        </div>
                        <div>
                          <div className="text-[11px] font-medium text-ink-2">Active TCP Sockets</div>
                          <div className="text-[17px] font-semibold text-ink font-mono tabular-nums mt-0.5">
                            {sOverview?.host_total_connections ?? 0} conns
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* Network Ports Monitoring Section */}
                <div className={`${INSET} p-5 space-y-3.5`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-ink-2" />
                      <h4 className="text-[13px] font-semibold text-ink">
                        Các cổng dịch vụ hệ thống đang giám sát (Monitored TCP Ports)
                      </h4>
                    </div>
                    <span className="text-[11px] text-ink-3 font-mono">Linux Kernel /proc/net/tcp</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="bg-surface border border-line p-3.5 rounded-ios flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-2 h-2 rounded-full bg-ok flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[13px] font-mono font-semibold text-ink">Port 80 (HTTP)</div>
                          <div className="text-[11px] text-ink-2 truncate">Web App / API Proxy</div>
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-ok bg-ok/12 px-2 py-1 rounded-ios-xs flex-shrink-0">
                        Active
                      </span>
                    </div>

                    <div className="bg-surface border border-line p-3.5 rounded-ios flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-2 h-2 rounded-full bg-ok flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[13px] font-mono font-semibold text-ink">Port 443 (HTTPS)</div>
                          <div className="text-[11px] text-ink-2 truncate">SSL Web Service</div>
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-ok bg-ok/12 px-2 py-1 rounded-ios-xs flex-shrink-0">
                        Active
                      </span>
                    </div>

                    <div className="bg-surface border border-line p-3.5 rounded-ios flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[13px] font-mono font-semibold text-ink">Port {selectedServer.ssh_port || 22} (SSH)</div>
                          <div className="text-[11px] text-ink-2 truncate">Host Terminal Shell</div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleOpenSshTab(selectedServer)}
                        className="text-[11px] font-semibold text-accent bg-accent/12 px-2.5 py-1.5 rounded-ios-xs transition-all hover:opacity-80 active:scale-95 flex items-center gap-1 flex-shrink-0"
                      >
                        Terminal
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Helpful Linux Commands Section */}
                <div className={`${INSET} p-5 space-y-3`}>
                  <h4 className="text-[13px] font-semibold text-ink flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-ink-2" />
                    Lệnh quản trị hệ thống nhanh (Host Command Helpers)
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-surface border border-line p-3 rounded-ios">
                      <span className="text-[11px] text-ink-2 block mb-1">Xem log ngầm Agent:</span>
                      <code className="text-[12px] font-mono text-accent break-all">sudo journalctl -u game-agent -f</code>
                    </div>
                    <div className="bg-surface border border-line p-3 rounded-ios">
                      <span className="text-[11px] text-ink-2 block mb-1">Kiểm tra các cổng đang lắng nghe:</span>
                      <code className="text-[12px] font-mono text-accent break-all">sudo ss -tulpn</code>
                    </div>
                    <div className="bg-surface border border-line p-3 rounded-ios">
                      <span className="text-[11px] text-ink-2 block mb-1">Kiểm tra trạng thái Agent service:</span>
                      <code className="text-[12px] font-mono text-accent break-all">sudo systemctl status game-agent</code>
                    </div>
                    <div className="bg-surface border border-line p-3 rounded-ios">
                      <span className="text-[11px] text-ink-2 block mb-1">Theo dõi tiến trình CPU/RAM:</span>
                      <code className="text-[12px] font-mono text-accent break-all">htop</code>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className={`${CARD} flex-1 flex flex-col items-center justify-center p-12 text-center space-y-4`}>
            <Activity className="w-12 h-12 text-ink-3" />
            <h2 className="text-[17px] font-semibold text-ink">Không có máy chủ hoạt động</h2>
            <button onClick={() => setShowAddModal(true)} className={BTN_PRIMARY}>
              <Plus className="w-4 h-4" />
              Thêm Server đầu tiên
            </button>
          </div>
        )}
      </main>

      {/* 3. Detail Container Monitor Split Screen Modal */}
      {selectedContainer && selectedServer && (
        <div className="fixed inset-0 scrim flex items-center justify-center p-4 md:p-6 z-50 animate-fade-in">
          <div className="w-full max-w-6xl material-strong border border-line rounded-ios-2xl p-5 shadow-e4 flex flex-col h-[90vh] gap-5 animate-sheet-in">

            {/* Modal Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 bg-ok/12 rounded-ios flex items-center justify-center text-ok flex-shrink-0">
                  <Activity className="w-[18px] h-[18px]" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[16px] font-semibold text-ink truncate">
                    Giám sát: <span className="text-accent font-mono">{selectedContainer.name}</span>
                  </h3>
                  <p className="text-[12px] text-ink-2 mt-0.5">
                    Container ID: <span className="font-mono text-ink-3">{selectedContainer.id.substring(0, 12)}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* Control Action Buttons */}
                <div className="flex items-center gap-1 bg-surface-2 p-1 rounded-ios border border-line">
                  <button
                    onClick={() => handleContainerAction('restart')}
                    disabled={isPerformingAction || selectedContainer.state !== 'running'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-ios-xs text-accent hover:bg-accent/12 font-semibold text-[12px] transition-all active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isPerformingAction ? 'animate-spin' : ''}`} />
                    Restart
                  </button>
                  <button
                    onClick={() => handleContainerAction('stop')}
                    disabled={isPerformingAction || selectedContainer.state !== 'running'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-ios-xs text-bad hover:bg-bad/12 font-semibold text-[12px] transition-all active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Stop
                  </button>
                  <button
                    onClick={() => handleContainerAction('start')}
                    disabled={isPerformingAction || selectedContainer.state === 'running'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-ios-xs text-ok hover:bg-ok/12 font-semibold text-[12px] transition-all active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Start
                  </button>
                </div>

                <button onClick={() => setSelectedContainer(null)} className={ICON_BTN} title="Đóng">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Split Content view */}
            <div className="flex-1 flex flex-col md:flex-row gap-5 overflow-hidden min-h-0">

              {/* Left Side: Live Stats widgets & details */}
              <div className="w-full md:w-1/3 flex flex-col gap-3 overflow-y-auto pr-1">
                <div className={`${INSET} p-4 space-y-4`}>
                  <div className={LABEL}>Thông số thời gian thực</div>

                  {containerStats ? (
                    <div className="space-y-4">
                      {/* CPU usage bar */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[12px]">
                          <span className="text-ink-2">Container CPU Usage</span>
                          <span className="text-ink font-semibold font-mono tabular-nums">{containerStats.cpu_percent.toFixed(2)} %</span>
                        </div>
                        <Meter value={containerStats.cpu_percent} tone="var(--c-accent)" />
                      </div>

                      {/* Memory usage bar */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[12px] gap-2">
                          <span className="text-ink-2 flex-shrink-0">Container Memory</span>
                          <span className="text-ink font-semibold font-mono tabular-nums text-right">
                            {formatBytes(containerStats.memory_used_bytes)} / {formatBytes(containerStats.memory_limit_bytes)} ({containerStats.memory_percent.toFixed(1)}%)
                          </span>
                        </div>
                        <Meter value={containerStats.memory_percent} tone="var(--c-alt)" />
                      </div>

                      {/* Additional metrics */}
                      <div className="border-t border-line pt-3.5 space-y-2.5 text-[12px]">
                        <div className="flex justify-between gap-2">
                          <span className="text-ink-2">Uptime</span>
                          <span className="font-mono text-ink font-medium flex items-center gap-1.5 tabular-nums">
                            <Clock className="w-3.5 h-3.5 text-ink-3" />
                            {Math.floor(containerStats.uptime_seconds / 3600)}h {Math.floor((containerStats.uptime_seconds % 3600) / 60)}m {containerStats.uptime_seconds % 60}s
                          </span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-ink-2">Container IP</span>
                          <span className="font-mono text-ink font-medium">{containerStats.ip_address || 'None'}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-ink-2">Network RX/TX</span>
                          <span className="font-mono text-ink font-medium tabular-nums">
                            {formatBytes(containerStats.network_rx_bytes)} / {formatBytes(containerStats.network_tx_bytes)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-ink-2">Disk Read/Write</span>
                          <span className="font-mono text-ink font-medium tabular-nums">
                            {formatBytes(containerStats.block_read_bytes)} / {formatBytes(containerStats.block_write_bytes)}
                          </span>
                        </div>
                      </div>

                      {/* Port mapping widget */}
                      <div className="border-t border-line pt-3.5 space-y-2">
                        <span className={`${LABEL} block`}>Port Mappings</span>
                        <div className="flex flex-wrap gap-1.5">
                          {containerStats.ports.length > 0 ? (
                            containerStats.ports.map((p, idx) => (
                              <span key={idx} className="bg-surface border border-line text-[11px] font-mono text-ink-2 px-2 py-0.5 rounded-ios-xs">
                                {p}
                              </span>
                            ))
                          ) : (
                            <span className="text-[12px] text-ink-3">Không có Port Mapping</span>
                          )}
                        </div>
                      </div>

                      {/* TCP Connections & Group by Port Widget */}
                      <div className="border-t border-line pt-3.5 space-y-3">
                        <span className={`${LABEL} flex items-center gap-1.5`}>
                          <Wifi className="w-3.5 h-3.5" />
                          Kết nối TCP (Group by Port)
                        </span>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-surface border border-line p-2.5 rounded-ios flex items-center gap-2.5">
                            <div className="p-2 bg-accent/12 text-accent rounded-ios-xs">
                              <Users className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[10px] font-medium text-ink-2 uppercase tracking-wide">Unique Clients</div>
                              <div className="text-[15px] font-semibold text-ink font-mono tabular-nums">
                                {containerStats.unique_connections ?? 0} <span className="text-[11px] text-ink-3 font-normal">IPs</span>
                              </div>
                            </div>
                          </div>

                          <div className="bg-surface border border-line p-2.5 rounded-ios flex items-center gap-2.5">
                            <div className="p-2 bg-ok/12 text-ok rounded-ios-xs">
                              <Activity className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[10px] font-medium text-ink-2 uppercase tracking-wide">Total Sockets</div>
                              <div className="text-[15px] font-semibold text-ink font-mono tabular-nums">
                                {containerStats.total_connections ?? 0} <span className="text-[11px] text-ink-3 font-normal">conns</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Per-port Breakdown */}
                        {containerStats.ports_stats && containerStats.ports_stats.length > 0 && (
                          <div className="space-y-2">
                            {containerStats.ports_stats.map((ps) => (
                              <div key={ps.port} className="bg-surface border border-line rounded-ios p-2.5 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono font-semibold text-accent bg-accent/12 px-2 py-0.5 rounded-ios-xs text-[11px]">
                                    Port :{ps.port}
                                  </span>
                                  <div className="flex items-center gap-2 text-[11px] font-mono">
                                    <span className="text-ink-2">
                                      <strong className="text-ok font-semibold">{ps.unique_connections}</strong> unique IP
                                    </span>
                                    <span className="text-ink-3">•</span>
                                    <span className="text-ink-2">
                                      <strong className="text-ink font-semibold">{ps.total_connections}</strong> sockets
                                    </span>
                                  </div>
                                </div>

                                {ps.unique_ips && ps.unique_ips.length > 0 ? (
                                  <div className="flex flex-wrap gap-1 pt-2 border-t border-line">
                                    {ps.unique_ips.slice(0, 10).map((ip, iidx) => (
                                      <span key={iidx} className="bg-surface-2 border border-line text-[10px] font-mono text-ink-2 px-1.5 py-0.5 rounded-ios-xs" title={ip}>
                                        {ip}
                                      </span>
                                    ))}
                                    {ps.unique_ips.length > 10 && (
                                      <span className="text-[10px] font-mono text-ink-3 px-1 py-0.5">
                                        +{ps.unique_ips.length - 10} IP khác...
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-ink-3">Chưa có kết nối active</div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                    </div>
                  ) : (
                    <div className="py-12 flex flex-col items-center justify-center text-ink-3 text-[12px]">
                      <RefreshCw className="w-5 h-5 animate-spin mb-2" />
                      Đang tải tài nguyên...
                    </div>
                  )}
                </div>

                <div className={`${INSET} p-4 flex gap-3 text-[12px] text-ink-2 items-start leading-relaxed`}>
                  <AlertTriangle className="w-4 h-4 text-warn flex-shrink-0 mt-0.5" />
                  <span>
                    Các hành động Restart, Stop, Start sẽ tương tác trực tiếp lên dịch vụ Docker của hệ thống. Vui lòng đảm bảo các client khác đã ngắt kết nối an toàn trước khi thực hiện.
                  </span>
                </div>
              </div>

              {/* Right Side: Terminal log stream with search bar */}
              <div className="flex-1 flex flex-col bg-surface-2 border border-line rounded-ios-lg overflow-hidden min-h-0">
                {/* Console Terminal Header */}
                <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-[12px] text-ink-2">
                  <div className="flex items-center gap-2 font-medium">
                    <Terminal className="w-4 h-4" />
                    <span>Real-time Log stream</span>
                  </div>

                  {/* Log Filter input */}
                  <input
                    type="text"
                    placeholder="Lọc log..."
                    value={logFilter}
                    onChange={e => setLogFilter(e.target.value)}
                    className="bg-surface border border-line rounded-ios-xs px-2.5 py-1 text-[12px] text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent w-44 font-mono"
                  />
                </div>

                {/* Terminal Body */}
                <div className="flex-grow p-4 overflow-y-auto font-mono text-[12px] bg-surface text-ink space-y-1 min-h-0">
                  {getFilteredLogs() ? (
                    <pre className="whitespace-pre-wrap leading-relaxed break-all">
                      {getFilteredLogs()}
                    </pre>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-ink-3">
                      <FileText className="w-7 h-7 mb-2" />
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
        <div className="fixed inset-0 scrim flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="w-full max-w-md material-strong border border-line rounded-ios-xl p-6 shadow-e4 space-y-5 animate-sheet-in">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-accent/12 rounded-ios flex items-center justify-center text-accent">
                <Plus className="w-[18px] h-[18px]" />
              </div>
              <h3 className="text-[17px] font-semibold tracking-tight text-ink">Đăng ký Server Game mới</h3>
            </div>

            <form onSubmit={handleAddServer} className="space-y-4">
              <div className="space-y-1.5">
                <label className={LABEL}>Tên Server</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Ví dụ: Minecraft Survival Server"
                  className={`${FIELD} text-[13px]`}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className={LABEL}>Agent URL (IP / Domain)</label>
                <input
                  type="url"
                  value={newUrl}
                  onChange={e => setNewUrl(e.target.value)}
                  placeholder="http://192.168.1.100:6678"
                  className={`${FIELD} text-[13px] font-mono`}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className={LABEL}>Mã bảo mật Token (Secret Key)</label>
                <input
                  type="text"
                  value={newToken}
                  onChange={e => setNewToken(e.target.value)}
                  placeholder="secret-agent-token-123"
                  className={`${FIELD} text-[13px] font-mono`}
                  required
                />
              </div>

              <div className="flex gap-2.5 justify-end pt-1">
                <button type="button" onClick={() => setShowAddModal(false)} className={`${BTN_QUIET} text-[13px] py-2`}>
                  Hủy bỏ
                </button>
                <button type="submit" className={`${BTN_PRIMARY} text-[13px] py-2`}>
                  Kết nối &amp; Lưu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Edit Server Modal */}
      {showEditModal && editingServer && (
        <div className="fixed inset-0 scrim flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="w-full max-w-md material-strong border border-line rounded-ios-xl p-6 shadow-e4 space-y-5 animate-sheet-in">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-accent/12 rounded-ios flex items-center justify-center text-accent">
                <Edit2 className="w-[18px] h-[18px]" />
              </div>
              <h3 className="text-[17px] font-semibold tracking-tight text-ink">Chỉnh sửa Server Game</h3>
            </div>

            <form onSubmit={handleEditServer} className="space-y-4">
              <div className="space-y-1.5">
                <label className={LABEL}>Tên Server</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="Ví dụ: Minecraft Survival Server"
                  className={`${FIELD} text-[13px]`}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className={LABEL}>Agent URL (IP / Domain)</label>
                <input
                  type="url"
                  value={editUrl}
                  onChange={e => setEditUrl(e.target.value)}
                  placeholder="http://192.168.1.100:6678"
                  className={`${FIELD} text-[13px] font-mono`}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className={LABEL}>Mã bảo mật Token (Secret Key)</label>
                <input
                  type="text"
                  value={editToken}
                  onChange={e => setEditToken(e.target.value)}
                  placeholder="secret-agent-token-123"
                  className={`${FIELD} text-[13px] font-mono`}
                  required
                />
              </div>

              <div className="flex gap-2.5 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false)
                    setEditingServer(null)
                  }}
                  className={`${BTN_QUIET} text-[13px] py-2`}
                >
                  Hủy bỏ
                </button>
                <button type="submit" className={`${BTN_PRIMARY} text-[13px] py-2`}>
                  Cập nhật &amp; Lưu
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
    </ThemeContext.Provider>
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
    <div className="fixed inset-0 scrim flex items-center justify-center p-4 md:p-6 z-50 animate-fade-in">
      <div className="w-full max-w-6xl material-strong border border-line rounded-ios-2xl p-5 shadow-e4 flex flex-col h-[88vh] gap-4 animate-sheet-in">

        {/* Top Header & Tab Bar */}
        <div className="flex flex-col gap-3 border-b border-line pb-3.5">

          {/* Title row */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-ios-sm bg-accent/12 text-accent flex-shrink-0">
                <Terminal className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-ink leading-tight">SSH Terminal</h3>
                <p className="text-[11.5px] text-ink-2 leading-tight">
                  {tabs.length} phiên đang mở
                </p>
              </div>
            </div>

            <button
              onClick={onCloseAll}
              className={`${ICON_BTN_SM} hover:text-bad flex-shrink-0`}
              title="Đóng tất cả các Tab"
            >
              <X className="w-[15px] h-[15px]" />
            </button>
          </div>

          {/* Tab strip — the new-tab control sits OUTSIDE the scroll area so its
              dropdown can float above the modal instead of being clipped. */}
          <div className="flex items-stretch gap-2 min-w-0">
            <div className="flex items-center gap-1.5 overflow-x-auto flex-1 min-w-0 pb-0.5">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId
                return (
                  <div
                    key={tab.id}
                    onClick={() => onSelectTab(tab.id)}
                    className={`group flex items-center gap-2 h-[32px] pl-2.5 pr-1.5 rounded-ios-sm text-[12px] font-mono font-semibold cursor-pointer transition-all flex-shrink-0 ${
                      isActive
                        ? 'bg-accent text-accent-ink shadow-e1'
                        : 'bg-surface-2 border border-line text-ink-2 hover:text-ink hover:bg-surface-3'
                    }`}
                  >
                    <Terminal className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-accent-ink' : 'text-ink-3'}`} />
                    <span className="truncate max-w-[140px]">{tab.serverName}</span>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onCloseTab(tab.id)
                      }}
                      className={`p-1 rounded-ios-xs transition-colors ${
                        isActive ? 'text-accent-ink/70 hover:text-accent-ink' : 'text-ink-3 hover:text-bad'
                      }`}
                      title="Đóng Tab SSH"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}
            </div>

            {/* New Tab Button + floating server picker */}
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setShowAddTabMenu(!showAddTabMenu)}
                className={`inline-flex items-center gap-1.5 h-[32px] px-3 rounded-ios-sm text-[12px] font-semibold border transition-all active:scale-[0.97] ${
                  showAddTabMenu
                    ? 'bg-surface-3 border-line-strong text-ink'
                    : 'bg-surface-2 border-line text-ink-2 hover:text-ink hover:bg-surface-3'
                }`}
                title="Mở Tab SSH mới"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tab mới</span>
              </button>

              {/* Server Picker Dropdown */}
              {showAddTabMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowAddTabMenu(false)} />
                  <div className="absolute top-full right-0 mt-2 w-64 material-strong border border-line rounded-ios-lg shadow-e4 z-50 p-1.5 space-y-0.5 animate-sheet-in">
                    <div className={`${LABEL} px-2.5 py-1.5`}>Chọn Server kết nối</div>
                    {servers.length > 0 ? (
                      servers.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            onOpenTab(s)
                            setShowAddTabMenu(false)
                          }}
                          className="w-full text-left flex items-center justify-between gap-2 px-2.5 py-2 hover:bg-surface-2 rounded-ios-sm text-[13px] font-medium text-ink transition-colors"
                        >
                          <span className="truncate">{s.name}</span>
                          <span className="text-[11px] font-mono text-ink-3 truncate max-w-[90px]">{s.agent_url}</span>
                        </button>
                      ))
                    ) : (
                      <div className="text-[12px] text-ink-3 px-2.5 py-2">Chưa có server nào</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
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
  const { theme } = useTheme()

  const [host, setHost] = useState(tab.sshHost)
  const [port, setPort] = useState(tab.sshPort)
  const [user, setUser] = useState(tab.sshUser)
  const [password, setPassword] = useState(tab.sshPassword || '')

  const [isConnected, setIsConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const termRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const xtermRef = useRef<XTerminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const themeRef = useRef(theme)
  themeRef.current = theme

  const xtermTheme = (mode: ThemeMode) =>
    mode === 'dark'
      ? {
          background: '#1c1c1e',
          foreground: '#f2f2f7',
          cursor: '#0a84ff',
          cursorAccent: '#1c1c1e',
          selectionBackground: 'rgba(10,132,255,0.35)'
        }
      : {
          background: '#ffffff',
          foreground: '#1c1c1e',
          cursor: '#007aff',
          cursorAccent: '#ffffff',
          selectionBackground: 'rgba(0,122,255,0.25)'
        }

  // Keep terminal colors in sync with the app theme
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = xtermTheme(theme)
    }
  }, [theme])

  const handleConnect = () => {
    if (!termRef.current) return
    setConnecting(true)
    setHasSession(true)

    // Reconnecting: drop the previous socket + terminal instance first.
    if (socketRef.current) socketRef.current.close()
    if (xtermRef.current) {
      xtermRef.current.dispose()
      xtermRef.current = null
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const hostHeader = window.location.host
    const wsUrl = `${wsProtocol}//${hostHeader}/api/servers/${tab.serverId}/ssh/ws?ssh_host=${encodeURIComponent(host)}&ssh_port=${port}&ssh_user=${encodeURIComponent(user)}&ssh_password=${encodeURIComponent(password)}`

    const ws = new WebSocket(wsUrl)
    socketRef.current = ws

    const term = new XTerminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"SF Mono", ui-monospace, Menlo, Monaco, "Courier New", monospace',
      theme: xtermTheme(themeRef.current)
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
      term.writeln(`\x1b[2m[*] Đang mở phiên SSH tới ${user}@${host}:${port} — chờ xác thực...\x1b[0m\r\n`)
    }

    ws.onmessage = (event) => {
      term.write(event.data)
    }

    ws.onerror = () => {
      setConnecting(false)
      term.writeln('\r\n\x1b[1;31m[-] Lỗi kết nối WebSocket SSH!\x1b[0m')
      term.writeln('\x1b[1;33m[*] Nguyên nhân chẩn đoán lỗi:\x1b[0m')
      term.writeln(`  • Máy chủ backend không thể kết nối tới Host "${host}" (Port: ${port}).`)
      term.writeln(`  • Thông tin xác thực SSH sai (User: "${user}").`)
      term.writeln(`  • Tường lửa (UFW/Iptables) chặn kết nối SSH vào cổng ${port}.\r\n`)
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

  // Tear down socket + terminal on unmount. Connecting is user-initiated —
  // credentials are typed in the session header first.
  useEffect(() => {
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

  const sshField =
    'h-[30px] bg-surface border border-line rounded-ios-xs px-2.5 text-ink font-mono text-[12px] ' +
    'transition-all focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ' +
    'disabled:opacity-55 disabled:cursor-not-allowed'

  const canConnect = host.trim() !== '' && user.trim() !== '' && !connecting

  return (
    <div
      style={{ display: isActive ? 'flex' : 'none' }}
      className="flex-col h-full gap-3"
    >
      {/* Session Controls Header */}
      <div className={`${INSET} px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2.5 text-[12px]`}>
        <div className="flex items-center gap-2">
          <span
            className="w-[7px] h-[7px] rounded-full flex-shrink-0"
            style={{
              backgroundColor: isConnected
                ? 'var(--c-ok)'
                : connecting
                  ? 'var(--c-warn)'
                  : 'var(--c-ink-3)'
            }}
          />
          <span className="font-semibold text-ink">
            {isConnected ? 'Đang kết nối' : connecting ? 'Đang mở phiên' : 'Chưa kết nối'}
          </span>
        </div>

        <div className="w-px h-5 bg-line" />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 flex-1 min-w-0">
          <label className="flex items-center gap-1.5">
            <span className="text-ink-2">Host</span>
            <input
              type="text"
              value={host}
              onChange={e => setHost(e.target.value)}
              disabled={isConnected}
              className={`${sshField} w-[128px]`}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-ink-2">Port</span>
            <input
              type="number"
              value={port}
              onChange={e => setPort(Number(e.target.value))}
              disabled={isConnected}
              className={`${sshField} w-[62px]`}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-ink-2">User</span>
            <input
              type="text"
              value={user}
              onChange={e => setUser(e.target.value)}
              disabled={isConnected}
              placeholder="root"
              className={`${sshField} w-[96px] placeholder:text-ink-3`}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-ink-2">Password</span>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={isConnected}
              placeholder="Mật khẩu SSH"
              onKeyDown={e => {
                if (e.key === 'Enter' && !isConnected && canConnect) handleConnect()
              }}
              className={`${sshField} w-[140px] placeholder:text-ink-3`}
            />
          </label>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isConnected ? (
            <button
              onClick={handleDisconnect}
              className="inline-flex items-center justify-center h-[30px] px-3.5 bg-bad/12 text-bad font-semibold rounded-ios-sm text-[12px] transition-all hover:bg-bad/20 active:scale-[0.97]"
            >
              Ngắt kết nối
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={!canConnect}
              className="inline-flex items-center justify-center gap-1.5 h-[30px] px-3.5 bg-accent text-accent-ink font-semibold rounded-ios-sm text-[12px] shadow-e1 transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {connecting ? 'Đang kết nối...' : hasSession ? 'Kết nối lại' : 'Kết nối SSH'}
            </button>
          )}
        </div>
      </div>

      {/* XTerm Container — terminal only mounts once a session is started */}
      <div className="flex-1 bg-surface border border-line rounded-ios-lg overflow-hidden relative">
        <div ref={termRef} className="w-full h-full p-4" />

        {!hasSession && (
          <div className="absolute inset-0 bg-surface flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="p-3.5 rounded-ios bg-surface-2 border border-line text-ink-2">
              <Terminal className="w-6 h-6" />
            </div>
            <h4 className="text-[14px] font-semibold text-ink">Phiên SSH chưa được mở</h4>
            <p className="text-[12px] text-ink-2 max-w-[380px] leading-relaxed">
              Nhập User và Mật khẩu SSH ở thanh phía trên, sau đó bấm{' '}
              <span className="font-semibold text-ink">Kết nối SSH</span> để bắt đầu phiên tới{' '}
              <span className="font-mono text-ink">{host}:{port}</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
