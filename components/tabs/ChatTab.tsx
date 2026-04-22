'use client'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import IssuePreviewCard from '@/components/IssuePreviewCard'
import AgentSelector from '@/components/AgentSelector'

// Chat types
interface ChatMessage { id: string; role: 'user'|'assistant'; content: string; model?: string; ts?: number; attachments?: string[]; image_url?: string; bookmarked?: boolean; agent_id?: string }
interface ChatConversation { id: string; title: string; model: string; messages: ChatMessage[]; createdAt: number; updatedAt: number; pinned?: boolean; project?: string|null; agent_id?: string; system_prompt?: string|null; forked_from?: string|null }

// MC-157: Auto-scroll lock indicator types
interface ScrollLockState {
  locked: boolean            // true = user scrolled up, auto-scroll paused
  missedMessages: number     // count of new messages since lock engaged
  lastScrollTop: number      // last scroll position for lock detection
}

// MC-160: Character/token counter types
interface InputCounterState {
  charCount: number
  tokenEstimate: number
  charLimit: number          // visual warning threshold for chars
  tokenLimit: number         // visual warning threshold for tokens
}

// MC-134: File preview card types
interface FilePreviewMeta {
  name: string
  extension: string
  sizeKB: number
  icon: string
  language: string | null
  truncated: boolean
}

const EmptyState = ({icon, message, action}: {icon:string, message:string, action?:string}) => (
  <div className='flex flex-col items-center justify-center py-16 text-white/50'>
    <span className='text-4xl mb-3'>{icon}</span>
    <p className='text-sm'>{message}</p>
    {action && <button className='mt-3 text-xs text-white/40 border border-white/10 px-3 py-1 rounded hover:bg-white/10'>{action}</button>}
  </div>
)

// ── Chat Component ────────────────────────────────────────────────────────
function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="text-sm">{children}</li>,
        code: ({ inline, children, className }: any) =>
          inline
            ? <code className="px-1.5 py-0.5 rounded bg-white/10 text-emerald-400 text-[11px] font-mono">{children}</code>
            : <CodeBlock className={className}>{children}</CodeBlock>,
        strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
        em: ({ children }) => <em className="italic text-white/40">{children}</em>,
        h1: ({ children }) => <h1 className="text-base font-bold text-white mb-2 mt-3">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold text-white mb-1.5 mt-3">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold text-white/70 mb-1 mt-2">{children}</h3>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-white/20 pl-3 my-2 text-white/40 italic">{children}</blockquote>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">{children}</a>,
        hr: () => <hr className="border-white/10 my-3" />,
        table: ({ children }) => <div className="overflow-x-auto my-3"><table className="w-full text-sm border-collapse">{children}</table></div>,
        thead: ({ children }) => <thead className="border-b border-white/10">{children}</thead>,
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => <tr className="border-b border-white/10 hover:bg-white/5 transition-colors">{children}</tr>,
        th: ({ children }) => <th className="text-left px-3 py-1.5 text-xs font-semibold text-white/40 uppercase tracking-wider">{children}</th>,
        td: ({ children }) => <td className="px-3 py-1.5 text-xs text-white/70">{children}</td>,
      }}>
      {content}
    </ReactMarkdown>
  )
}

function groupChatsByDate(chats: ChatConversation[]): { label: string; items: ChatConversation[]; pinned?: boolean }[] {
  const now = Date.now()
  const DAY = 86400000
  const pinned = chats.filter(c => c.pinned)
  const unpinned = chats.filter(c => !c.pinned)
  const groups: { label: string; items: ChatConversation[]; pinned?: boolean }[] = []
  if (pinned.length > 0) groups.push({ label: 'Pinned', items: pinned, pinned: true })
  const dateGroups: { label: string; items: ChatConversation[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This Week', items: [] },
    { label: 'Older', items: [] },
  ]
  for (const c of unpinned) {
    const age = now - c.updatedAt
    if (age < DAY) dateGroups[0].items.push(c)
    else if (age < DAY * 2) dateGroups[1].items.push(c)
    else if (age < DAY * 7) dateGroups[2].items.push(c)
    else dateGroups[3].items.push(c)
  }
  for (const g of dateGroups) if (g.items.length > 0) groups.push(g)
  return groups
}

function stripMarkdownPreview(text: string): string {
  return text
    .replace(/[*#>`\-]/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

const AGENT_MODEL_MAP: Record<string, string> = {
  'main': 'Claude Max',
  'kemuni-sme': 'Claude Max',
  'vespera-sme': 'Claude Max',
  'scout': 'Gemma 3 4B (local)',
}

// Model options available in chat (agent default or per-message override).
// Grouped by provider with context window sizes.
const MODEL_OPTIONS: { id: string; label: string; desc: string; provider: string; ctx?: string }[] = [
  { id: 'default',                       label: '⚡ Agent default',          desc: 'Use the selected agent\'s default model', provider: 'System' },
  // Anthropic
  { id: 'anthropic/claude-sonnet-4-6',   label: '🟣 Claude Sonnet 4.6',     desc: 'Best for complex tasks',     provider: 'Anthropic', ctx: '200k' },
  { id: 'anthropic/claude-haiku-4-5',    label: '🔵 Claude Haiku 4.5',      desc: 'Fast, lightweight',          provider: 'Anthropic', ctx: '200k' },
  { id: 'anthropic/claude-opus-4-6',     label: '🔶 Claude Opus 4.6',       desc: 'Most powerful',              provider: 'Anthropic', ctx: '200k' },
  // OpenRouter
  { id: 'openrouter/auto',               label: '🔀 OpenRouter auto',        desc: 'Best available via OpenRouter', provider: 'OpenRouter' },
  { id: 'openrouter/google/gemini-2.5-pro', label: '🔷 Gemini 2.5 Pro',     desc: 'Google flagship',            provider: 'OpenRouter', ctx: '1M' },
  { id: 'openrouter/deepseek/deepseek-r1', label: '🧩 DeepSeek R1',         desc: 'Reasoning model',            provider: 'OpenRouter', ctx: '128k' },
  { id: 'openrouter/meta-llama/llama-4-maverick', label: '🦙 Llama 4 Maverick', desc: 'Open weights',          provider: 'OpenRouter', ctx: '1M' },
  { id: 'openrouter/qwen/qwen3-235b-a22b', label: '🌐 Qwen3 235B',         desc: 'MoE reasoning',              provider: 'OpenRouter', ctx: '128k' },
  // Ollama (local)
  { id: 'ollama/gemma3:4b',              label: '🟢 Gemma 3 4B',            desc: 'Private, free, offline',     provider: 'Ollama', ctx: '128k' },
]

const MODEL_PROVIDERS = Array.from(new Set(MODEL_OPTIONS.map(m => m.provider)))

// Expanded file type groups
const FILE_TYPE_GROUPS = [
  { label: 'Code',       accept: '.ts,.tsx,.js,.jsx,.mjs,.cjs,.vue,.svelte,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.cpp,.h,.cs,.php' },
  { label: 'Config',     accept: '.json,.yaml,.yml,.toml,.env,.ini,.cfg,.conf,.lock' },
  { label: 'Text / Docs', accept: '.txt,.md,.mdx,.rst,.csv,.log,.xml,.html,.css,.scss' },
  { label: 'Shell',      accept: '.sh,.bash,.zsh,.fish,.ps1,.bat,.cmd' },
  { label: 'Any text',   accept: '*' },
]

const AGENT_BADGE_MAP: Record<string, string> = {
  'main': '🧠',
  'kemuni-sme': '🚀',
  'vespera-sme': '🖤',
  'scout': '🔍',
}

const PROJECT_TAG_COLORS: Record<string, string> = {
  'Kemuni': '#3b82f6',
  'Vespera': '#a855f7',
  'Infrastructure': '#6b7280',
  'General': '#10b981',
}
const PROJECT_CYCLE = [null, 'Kemuni', 'Vespera', 'Infrastructure', 'General'] as const

const PROMPT_TEMPLATES = [
  { label: '🗺️ Plan a feature', text: 'Help me plan a new feature for Kemuni. The feature is: ' },
  { label: '🐛 Debug code', text: 'I have a bug in my code. Here\'s what\'s happening:\n\n' },
  { label: '📋 Write a PRD', text: 'Write a product requirements document for: ' },
  { label: '🔍 Research topic', text: 'Research and summarize the latest developments in: ' },
  { label: '✍️ Draft a message', text: 'Draft a professional message to: \n\nContext: ' },
  { label: '⚡ Optimize this', text: 'Review and optimize the following code for performance and readability:\n\n```\n\n```' },
]

// ── Syntax Highlighter ────────────────────────────────────────────────────
function highlightCode(code: string, lang: string): React.ReactNode[] {
  const supported = ['javascript','typescript','js','ts','tsx','jsx','python','py','bash','sh','css','html','json','go','rust','rs','java','sql','yaml','yml']
  if (!supported.includes(lang.toLowerCase())) {
    return [<span key="raw" style={{color:'#a8d5a2'}}>{code}</span>]
  }
  type Token = { type: 'keyword'|'string'|'comment'|'number'|'function'|'plain'; value: string }
  const tokens: Token[] = []
  let remaining = code
  let i = 0

  const KEYWORD_RE = /^(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|extends|import|export|default|from|new|this|typeof|instanceof|void|null|undefined|true|false|async|await|try|catch|finally|throw|in|of|type|interface|enum|implements|static|public|private|protected|abstract|readonly|override|def|print|pass|lambda|with|as|and|or|not|is|elif|yield|global|nonlocal|select|from|where|insert|update|delete|create|table|index|join|on|group|by|order|having|limit|func|struct|package|var|map|chan|go|defer|range|make|append|len|cap)\b/
  const FUNC_RE = /^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/
  const NUM_RE = /^(-?\d+\.?\d*(?:[eE][+-]?\d+)?|0x[0-9a-fA-F]+)\b/
  const STR_RE = /^(`[^`]*`|'[^'\\]*(?:\\[\s\S][^'\\]*)*'|"[^"\\]*(?:\\[\s\S][^"\\]*)*")/
  const COMMENT_RE = /^(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)/

  while (remaining.length > 0) {
    i++
    if (i > 5000) break // guard
    let m: RegExpMatchArray|null

    m = remaining.match(COMMENT_RE)
    if (m) { tokens.push({ type: 'comment', value: m[0] }); remaining = remaining.slice(m[0].length); continue }

    m = remaining.match(STR_RE)
    if (m) { tokens.push({ type: 'string', value: m[0] }); remaining = remaining.slice(m[0].length); continue }

    m = remaining.match(KEYWORD_RE)
    if (m) { tokens.push({ type: 'keyword', value: m[0] }); remaining = remaining.slice(m[0].length); continue }

    m = remaining.match(FUNC_RE)
    if (m) { tokens.push({ type: 'function', value: m[1] }); remaining = remaining.slice(m[1].length); continue }

    m = remaining.match(NUM_RE)
    if (m) { tokens.push({ type: 'number', value: m[0] }); remaining = remaining.slice(m[0].length); continue }

    tokens.push({ type: 'plain', value: remaining[0] }); remaining = remaining.slice(1)
  }

  const COLOR_MAP: Record<string, React.CSSProperties> = {
    keyword:  { color: '#79b8ff' },
    string:   { color: '#a8d5a2' },
    comment:  { color: '#6b7280', fontStyle: 'italic' },
    number:   { color: '#f97316' },
    function: { color: '#e2c08d' },
    plain:    {},
  }
  return tokens.map((t, idx) => (
    <span key={idx} style={COLOR_MAP[t.type] || {}}>{t.value}</span>
  ))
}

// ── Code Block with copy button ───────────────────────────────────────────
function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false)
  const lang = (className || '').replace('language-', '').toLowerCase() || 'text'
  const code = typeof children === 'string' ? children : String(children)
  const highlighted = highlightCode(code, lang)

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="group relative my-2">
      <div className="flex items-center justify-between px-3 py-1 rounded-t-lg bg-[#0f0f0f] border border-white/10 border-b-0">
        <span className="text-[9px] text-white/30 font-mono uppercase tracking-widest">{lang}</span>
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 text-[10px] px-2 py-0.5 rounded transition-all text-white/40 hover:text-white"
          style={{ background: '#1a1a1a' }}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 rounded-b-lg bg-[#080808] border border-white/10 overflow-x-auto">
        <code className="text-[11px] font-mono whitespace-pre">{highlighted}</code>
      </pre>
    </div>
  )
}

export default function ChatTab({ selectedBusiness }: { selectedBusiness?: string | null }) {
  const [chats, setChats] = useState<ChatConversation[]>([])
  const [activeChat, setActiveChat] = useState<string|null>(null)
  const [search, setSearch] = useState('')
  const [inputVal, setInputVal] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [selectedFile, setSelectedFile] = useState<{name: string; content: string}|null>(null)
  const [chatError, setChatError] = useState<string|null>(null)
  const [copiedId, setCopiedId] = useState<string|null>(null)
  const [lastUserMsg, setLastUserMsg] = useState<ChatMessage|null>(null)
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  // MC-158: scroll lock indicator core state
  const [scrollLockState, setScrollLockState] = useState<ScrollLockState>({ locked: false, missedMessages: 0, lastScrollTop: 0 })
  const [renamingTitle, setRenamingTitle] = useState<string|null>(null)
  const [selectedAgent, setSelectedAgent] = useState<string>('main')
  const [selectedModel, setSelectedModel] = useState<string>('default')
  const [showFileTypePicker, setShowFileTypePicker] = useState(false)
  const fileTypePickerRef = useRef<HTMLDivElement>(null)
  const [sidebarFocusIdx, setSidebarFocusIdx] = useState<number>(-1)
  // Feature 1: pasted image
  const [pastedImage, setPastedImage] = useState<string|null>(null)
  // Feature 5: system prompt popover
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const [systemPromptDraft, setSystemPromptDraft] = useState('')
  // Feature 6: inline edit
  const [editingMsgId, setEditingMsgId] = useState<string|null>(null)
  const [editingMsgContent, setEditingMsgContent] = useState('')
  // Feature 7: unread
  const [unreadChat, setUnreadChat] = useState(false)
  const unreadChatRef = useRef(false)
  // Feature 9: project filter
  const [projectFilter, setProjectFilter] = useState<string|null>(null)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  // Feature 10: sidebar collapsed
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('mc-chat-sidebar-collapsed') === 'true'
    return false
  })
  // Feature 11: voice input
  const [speechAvailable, setSpeechAvailable] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const speechRecognitionRef = useRef<any>(null)
  // Feature 12: full-text search
  const [searchMode, setSearchMode] = useState<'title'|'messages'>('title')
  const [searchResults, setSearchResults] = useState<Array<{id:string;conversation_id:string;content:string;role:string;created_at:string}>>([])
  const [isSearching, setIsSearching] = useState(false)
  // Feature 13: follow-up suggestions
  const [followUpSuggestions, setFollowUpSuggestions] = useState<string[]>([])
  // MC-184: NL issue draft from chat
  const [issueDraft, setIssueDraft] = useState<{title:string;type:string;priority:string;assignee:string;acceptance_criteria:string}|null>(null)
  // Feature 14: keyboard cheatsheet
  const [showShortcuts, setShowShortcuts] = useState(false)
  // Feature 16: starred filter
  const [starredFilter, setStarredFilter] = useState(false)
  // Feature 18: export dropdown
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const printRef = useRef(false)
  // Feature 20: session context viewer
  const [showContextViewer, setShowContextViewer] = useState(false)
  // NEW: Slash command palette
  const [showSlashPalette, setShowSlashPalette] = useState(false)
  const [slashPaletteIdx, setSlashPaletteIdx] = useState(0)
  // NEW: Tool call indicators (ephemeral, local-only)
  const [toolIndicators, setToolIndicators] = useState<Record<string, {name:string;input:string;output?:string;expanded:boolean}[]>>({})
  // NEW: Thinking/reasoning content per stream message
  const [thinkingContent, setThinkingContent] = useState<Record<string,string>>({})
  // NEW: Approval buttons state (per message id, true = used)
  const [approvalUsed, setApprovalUsed] = useState<Record<string,boolean>>({})
  // NEW: File browser modal
  const [showFileBrowser, setShowFileBrowser] = useState(false)
  const [fileBrowserPath, setFileBrowserPath] = useState('')
  const [fileBrowserEntries, setFileBrowserEntries] = useState<{name:string;isDir:boolean;path:string}[]>([])
  // NEW: Image URL input
  const [showImageUrlInput, setShowImageUrlInput] = useState(false)
  const [imageUrlDraft, setImageUrlDraft] = useState('')
  const [imageUrlPreview, setImageUrlPreview] = useState<string|null>(null)
  const [sidebarTab, setSidebarTab] = useState<'mine'|'heartbeats'>('mine')
  const [ocSessions, setOcSessions] = useState<any[]>([])
  const [ocLoading, setOcLoading] = useState(false)
  // NEW: Send-to-agent dropdown
  const [showSendToAgent, setShowSendToAgent] = useState(false)
  const sendToAgentRef = useRef<HTMLDivElement>(null)
  // NEW: Drag-and-drop
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  // NEW: Prompt templates popover
  const [showPromptTemplates, setShowPromptTemplates] = useState(false)
  const promptTemplatesRef = useRef<HTMLDivElement>(null)
  // NEW: @-mention dropdown
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIdx, setMentionIdx] = useState(0)
  const abortControllerRef = useRef<AbortController|null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const AGENT_OPTIONS = [
    { id: 'main', label: '🧠 KAOS', desc: 'Chief of Staff' },
    { id: 'kemuni-sme', label: '🚀 Kemuni SME', desc: 'Kemuni Specialist' },
    { id: 'vespera-sme', label: '🖤 Vespera SME', desc: 'Vespera Specialist' },
    { id: 'scout', label: '🔍 Scout', desc: 'Research Agent' },
    { id: 'ops', label: '⚙️ Ops', desc: 'Operations Agent' },
  ]
  const currentAgent = AGENT_OPTIONS.find(a => a.id === selectedAgent) || AGENT_OPTIONS[0]

  // Slash command definitions
  const SLASH_COMMANDS = [
    { cmd: '/new',     icon: '➕', desc: 'Start a new conversation' },
    { cmd: '/clear',   icon: '🗑️', desc: 'Clear all messages in this chat' },
    { cmd: '/status',  icon: '📊', desc: 'Show session info (agent, model, messages)' },
    { cmd: '/compact', icon: '📦', desc: 'Ask AI to summarize conversation so far' },
    { cmd: '/pin',     icon: '📌', desc: 'Toggle pin on current conversation' },
    { cmd: '/export',  icon: '↓',  desc: 'Export this conversation as Markdown' },
    { cmd: '/imagine', icon: '🎨', desc: 'Generate an image: /imagine a purple cat in space' },
    { cmd: '/tasks',   icon: '📋', desc: 'Show open tasks for current sprint' },
    { cmd: '/deploy',  icon: '🚀', desc: 'Trigger a deploy or show deploy status' },
    { cmd: '/agents',  icon: '👥', desc: 'List active agents and their status' },
  ]
  const slashFilter = inputVal.startsWith('/') ? SLASH_COMMANDS.filter(c => c.cmd.startsWith(inputVal.split(' ')[0].toLowerCase())) : SLASH_COMMANDS

  // Load chats from Supabase on mount, restore active chat from localStorage
  useEffect(() => {
    const savedActiveChat = typeof window !== 'undefined' ? localStorage.getItem('mc-active-chat') : null
    fetch('/api/chat/conversations')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const normalized: ChatConversation[] = data.map((c: any) => ({
            id: c.id,
            title: c.title,
            model: c.model,
            messages: (c.messages || []).map((m: any) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              model: m.model,
              ts: m.created_at ? new Date(m.created_at).getTime() : undefined,
              image_url: m.image_url || undefined,
              bookmarked: m.bookmarked || false,
            })),
            createdAt: new Date(c.created_at).getTime(),
            updatedAt: new Date(c.updated_at).getTime(),
            pinned: c.pinned || false,
            project: c.project || null,
            agent_id: c.agent_id || 'main',
            system_prompt: c.system_prompt || null,
            forked_from: c.forked_from || null,
          }))
          setChats(normalized)
          if (savedActiveChat && normalized.find(c => c.id === savedActiveChat)) {
            setActiveChat(savedActiveChat)
          }
        }
      })
      .catch(() => {})
  }, [])

  // Persist active chat to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (activeChat) localStorage.setItem('mc-active-chat', activeChat)
      else localStorage.removeItem('mc-active-chat')
    }
  }, [activeChat])

  // Persist sidebar collapsed state
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('mc-chat-sidebar-collapsed', String(sidebarCollapsed))
    }
  }, [sidebarCollapsed])

  // Feature 7: unread document title
  useEffect(() => {
    if (unreadChat) {
      document.title = '● Todero'
    } else {
      document.title = 'Todero'
    }
  }, [unreadChat])

  // Clear unread when ChatTab is mounted/visible
  useEffect(() => {
    setUnreadChat(false)
    unreadChatRef.current = false
    document.title = 'Todero'
  }, [])

  // Detect when user scrolls up (so we don't hijack scroll during streaming)
  // MC-158: also track scroll lock state and last scroll position
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const onScroll = () => {
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80
      setUserScrolledUp(!atBottom)
      setScrollLockState(prev => ({
        ...prev,
        locked: !atBottom,
        lastScrollTop: container.scrollTop,
        // Reset missed count when user scrolls back to bottom
        missedMessages: atBottom ? 0 : prev.missedMessages,
      }))
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [activeChat])

  // Auto-scroll to bottom only when user hasn't scrolled up
  // MC-158: increment missed messages when new messages arrive while locked
  const prevMsgCountRef = useRef(0)
  useEffect(() => {
    const currentCount = activeConv?.messages.length ?? 0
    if (userScrolledUp && currentCount > prevMsgCountRef.current) {
      const delta = currentCount - prevMsgCountRef.current
      setScrollLockState(prev => ({ ...prev, missedMessages: prev.missedMessages + delta }))
    }
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevMsgCountRef.current = currentCount
  }, [chats, loading, userScrolledUp])

  // Scroll to bottom when switching chats — reset lock state
  useEffect(() => {
    setUserScrolledUp(false)
    setScrollLockState({ locked: false, missedMessages: 0, lastScrollTop: 0 })
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'instant' }), 50)
  }, [activeChat])

  // Sync system prompt draft when active conv changes
  useEffect(() => {
    const conv = chats.find(c => c.id === activeChat)
    setSystemPromptDraft(conv?.system_prompt || '')
    setShowSystemPrompt(false)
  }, [activeChat])

  // Poll active conversation while sending (catches dropped streams on tab switch/refresh)
  const reloadActiveConv = useCallback(async () => {
    if (!activeChat) return
    try {
      const res = await fetch('/api/chat/conversations')
      const data = await res.json()
      if (!Array.isArray(data)) return
      const conv = data.find((c: any) => c.id === activeChat)
      if (!conv) return
      const normalized: ChatConversation = {
        id: conv.id,
        title: conv.title,
        model: conv.model,
        messages: (conv.messages || []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          model: m.model,
          ts: m.created_at ? new Date(m.created_at).getTime() : undefined,
          image_url: m.image_url || undefined,
          bookmarked: m.bookmarked || false,
        })),
        createdAt: new Date(conv.created_at).getTime(),
        updatedAt: new Date(conv.updated_at).getTime(),
        pinned: conv.pinned || false,
        project: conv.project || null,
        agent_id: conv.agent_id || 'main',
        system_prompt: conv.system_prompt || null,
        forked_from: conv.forked_from || null,
      }
      setChats(prev => prev.map(c => c.id === activeChat ? normalized : c))
    } catch { /* ignore */ }
  }, [activeChat])

  // On tab visibility restored, reload active conv in case stream completed while away
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') reloadActiveConv()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reloadActiveConv])

  // Feature 11: detect speech API availability
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SR) setSpeechAvailable(true)
    }
  }, [])

  // Feature 18: close export menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
      if (sendToAgentRef.current && !sendToAgentRef.current.contains(e.target as Node)) {
        setShowSendToAgent(false)
      }
      if (promptTemplatesRef.current && !promptTemplatesRef.current.contains(e.target as Node)) {
        setShowPromptTemplates(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Feature 1: paste image listener
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (!blob) continue
          const reader = new FileReader()
          reader.onload = (ev) => {
            const dataUrl = ev.target?.result as string
            setPastedImage(dataUrl)
          }
          reader.readAsDataURL(blob)
          e.preventDefault()
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // NEW: Load file browser entries when path changes
  useEffect(() => {
    if (!showFileBrowser) return
    fetch(`/api/files?path=${encodeURIComponent(fileBrowserPath)}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setFileBrowserEntries(data) })
      .catch(() => {})
  }, [showFileBrowser, fileBrowserPath])

  // Fetch agent activity when sidebar tab switches to heartbeats
  useEffect(() => {
    if (sidebarTab === 'mine') return
    setOcLoading(true)
    fetch('/api/status').then(r => r.json()).then(data => {
      const activity: any[] = data.recentActivity || []
      setOcSessions(activity)
    }).catch(() => {}).finally(() => setOcLoading(false))
  }, [sidebarTab])

  // Auto-grow textarea
  const adjustTextarea = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  const newChat = async () => {
    const id = 'chat-' + Date.now()
    const conv: ChatConversation = {
      id, title: 'New Chat', model: 'kaos', messages: [],
      createdAt: Date.now(), updatedAt: Date.now(),
      pinned: false, project: null, agent_id: selectedAgent, system_prompt: null,
    }
    setChats([conv, ...chats])
    setActiveChat(id)
    await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title: 'New Chat', model: 'kaos', agent_id: selectedAgent }),
    })
  }

  // NEW: Clear all messages in active conversation
  const clearChat = async (convId: string) => {
    await fetch(`/api/chat/messages?conversation_id=${convId}&clear=true`, { method: 'DELETE' })
    setChats(prev => prev.map(c => c.id === convId ? { ...c, messages: [] } : c))
  }

  // NEW: Execute slash command
  const executeSlashCommand = async (cmd: string) => {
    setInputVal('')
    setShowSlashPalette(false)
    if (!activeConv) return
    if (cmd === '/new') {
      await newChat()
    } else if (cmd === '/clear') {
      await clearChat(activeConv.id)
    } else if (cmd === '/status') {
      const mdl = AGENT_MODEL_MAP[selectedAgent] || 'Claude Max'
      const tokEst = activeConv ? Math.round(activeConv.messages.reduce((sum, m) => sum + m.content.length, 0) / 4) : 0
      const tokLabel = tokEst >= 1000 ? `~${(tokEst/1000).toFixed(1)}k / 200k tokens` : `~${tokEst} / 200k tokens`
      const statusMsg: ChatMessage = {
        id: 'status-' + Date.now(),
        role: 'assistant',
        content: `**Session Status**\n- Session key: \`mc-chat-${activeConv.id}\`\n- Agent: ${selectedAgent} (${currentAgent.label})\n- Model: ${mdl}\n- Messages: ${activeConv.messages.length}\n- Est. tokens: ${tokLabel}\n- Pinned: ${activeConv.pinned ? 'yes' : 'no'}\n- Project: ${activeConv.project || 'none'}`,
        ts: Date.now(),
      }
      setChats(prev => prev.map(c => c.id === activeConv.id ? { ...c, messages: [...c.messages, statusMsg] } : c))
    } else if (cmd === '/compact') {
      const msgId = 'msg-compact-' + Date.now()
      setInputVal('')
      await doSend('[System: Please summarize our conversation so far in a brief paragraph, then we\'ll continue from that summary]', msgId, activeConv, chats)
    } else if (cmd === '/pin') {
      await togglePin(activeConv.id, !activeConv.pinned)
    } else if (cmd === '/export') {
      exportChat(activeConv)
    } else if (cmd === '/imagine') {
      const prompt = inputVal.replace('/imagine', '').trim()
      if (!prompt) {
        const hint: ChatMessage = { id: 'hint-'+Date.now(), role:'assistant', content:'Usage: `/imagine <description>` — e.g. `/imagine a purple cat floating in space`', ts: Date.now() }
        setChats(prev => prev.map(c => c.id === activeConv?.id ? { ...c, messages: [...c.messages, hint] } : c))
        return
      }
      setLoading(true)
      const userMsg: ChatMessage = { id: 'img-user-'+Date.now(), role:'user', content:`🎨 /imagine ${prompt}`, ts: Date.now() }
      const placeholderId = 'img-'+Date.now()
      const placeholder: ChatMessage = { id: placeholderId, role:'assistant', content:'⏳ Generating image…', ts: Date.now() }
      setChats(prev => prev.map(c => c.id === activeConv?.id ? { ...c, messages: [...c.messages, userMsg, placeholder] } : c))
      try {
        const r = await fetch('/api/imagine', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ prompt }) })
        const d = await r.json()
        if (d.url) {
          setChats(prev => prev.map(c => c.id === activeConv?.id ? {
            ...c, messages: c.messages.map(m => m.id === placeholderId ? { ...m, content: `![generated](${d.url})`, image_url: d.url } : m)
          } : c))
        } else {
          setChats(prev => prev.map(c => c.id === activeConv?.id ? {
            ...c, messages: c.messages.map(m => m.id === placeholderId ? { ...m, content: `❌ Image gen failed: ${d.error||'unknown error'}` } : m)
          } : c))
        }
      } catch(e) {
        setChats(prev => prev.map(c => c.id === activeConv?.id ? {
          ...c, messages: c.messages.map(m => m.id === placeholderId ? { ...m, content: '❌ Network error generating image' } : m)
        } : c))
      } finally {
        setLoading(false)
      }
    } else if (cmd === '/tasks') {
      try {
        const r = await fetch('/api/issues?limit=0')
        const data = await r.json()
        const issues = Array.isArray(data) ? data : data?.data ?? []
        const open = issues.filter((i: any) => i.status === 'open' || i.status === 'in_progress')
        const lines = open.slice(0, 15).map((i: any) => `- **${i.task_key || '?'}** ${i.title} — _${i.status}_ (${i.priority || 'med'}) ${i.assignee ? `→ ${i.assignee}` : ''}`).join('\n')
        const tasksMsg: ChatMessage = { id: 'tasks-'+Date.now(), role: 'assistant', content: `**Open Tasks** (${open.length})\n\n${lines || '_No open tasks_'}`, ts: Date.now() }
        setChats(prev => prev.map(c => c.id === activeConv.id ? { ...c, messages: [...c.messages, tasksMsg] } : c))
      } catch {
        const errMsg: ChatMessage = { id: 'tasks-err-'+Date.now(), role: 'assistant', content: '❌ Could not fetch tasks', ts: Date.now() }
        setChats(prev => prev.map(c => c.id === activeConv.id ? { ...c, messages: [...c.messages, errMsg] } : c))
      }
    } else if (cmd === '/deploy') {
      const deployMsg: ChatMessage = { id: 'deploy-'+Date.now(), role: 'assistant', content: '**Deploy Status**\n\n- Vercel: auto-deploy on push to `main`\n- Last deploy: check [Vercel dashboard](https://vercel.com)\n- To trigger: push to main or run `vercel --prod`\n\n_Tip: Use the chat to ask KAOS to deploy._', ts: Date.now() }
      setChats(prev => prev.map(c => c.id === activeConv.id ? { ...c, messages: [...c.messages, deployMsg] } : c))
    } else if (cmd === '/agents') {
      const agentLines = AGENT_OPTIONS.map(a => `- ${a.label} — ${a.desc}`).join('\n')
      const agentsMsg: ChatMessage = { id: 'agents-'+Date.now(), role: 'assistant', content: `**Active Agents**\n\n${agentLines}\n\n_Select an agent using the dropdown above the input._`, ts: Date.now() }
      setChats(prev => prev.map(c => c.id === activeConv.id ? { ...c, messages: [...c.messages, agentsMsg] } : c))
    }
  }

  const deleteChat = async (id: string) => {
    setChats(prev => prev.filter(c => c.id !== id))
    if (activeChat === id) setActiveChat(null)
    await fetch(`/api/chat/conversations?id=${id}`, { method: 'DELETE' })
  }

  const renameChat = async (id: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    setChats(prev => prev.map(c => c.id === id ? { ...c, title: trimmed } : c))
    setRenamingTitle(null)
    await fetch('/api/chat/conversations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title: trimmed }),
    })
  }

  // Feature 4: pin/unpin
  const togglePin = async (id: string, pinned: boolean) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, pinned } : c))
    await fetch('/api/chat/conversations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pinned }),
    })
  }

  // Feature 9: set project
  const setConvProject = async (id: string, project: string|null) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, project } : c))
    await fetch('/api/chat/conversations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, project }),
    })
  }

  // Feature 5: save system prompt
  const saveSystemPrompt = async (id: string, system_prompt: string) => {
    const val = system_prompt.trim() || null
    setChats(prev => prev.map(c => c.id === id ? { ...c, system_prompt: val } : c))
    await fetch('/api/chat/conversations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, system_prompt: val }),
    })
  }

  const exportChat = (conv: ChatConversation) => {
    downloadConvMd(conv)
  }

  const activeConv = chats.find(c => c.id === activeChat)

  // Feature 9 + 16: filter by project and/or starred
  const projectFilteredChats = (() => {
    let result = projectFilter ? chats.filter(c => c.project === projectFilter) : chats
    if (starredFilter) {
      result = result.filter(c => c.messages.some(m => m.bookmarked))
    }
    return result
  })()

  const filteredChats = searchMode === 'messages'
    ? chats.filter(c => searchResults.some(r => r.conversation_id === c.id))
    : projectFilteredChats.filter(c =>
        c.title.toLowerCase().includes(search.toLowerCase())
      )

  // Feature 15: context budget
  const contextTokenEstimate = activeConv
    ? Math.round(activeConv.messages.reduce((sum, m) => sum + m.content.length, 0) / 4)
    : 0
  const contextTokenColor = contextTokenEstimate > 150000 ? 'text-red-500' : contextTokenEstimate > 50000 ? 'text-yellow-500' : 'text-white/30'
  const contextTokenLabel = contextTokenEstimate >= 1000
    ? `~${(contextTokenEstimate / 1000).toFixed(1)}k / 200k tokens`
    : `~${contextTokenEstimate} / 200k tokens`

  // Cmd+K / arrow-key nav wired up after helpers defined (see below)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        newChat()
        return
      }
      // Feature 14: ⌘/ focus input
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        textareaRef.current?.focus()
        return
      }
      // Feature 14: Esc to close panels
      if (e.key === 'Escape') {
        setShowShortcuts(false)
        setShowContextViewer(false)
        setShowExportMenu(false)
        setShowSlashPalette(false)
        setShowFileBrowser(false)
        setShowSendToAgent(false)
        setShowMentionDropdown(false)
        setShowPromptTemplates(false)
        return
      }
      if (document.activeElement === textareaRef.current) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSidebarFocusIdx(i => Math.min(i + 1, filteredChats.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSidebarFocusIdx(i => Math.max(i - 1, 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filteredChats.length])

  useEffect(() => {
    if (sidebarFocusIdx < 0 || !filteredChats[sidebarFocusIdx]) return
    setActiveChat(filteredChats[sidebarFocusIdx].id)
  }, [sidebarFocusIdx])

  const persistMessage = async (convId: string, msg: ChatMessage) => {
    await fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: msg.id,
        conversation_id: convId,
        role: msg.role,
        content: msg.content,
        model: msg.model || null,
        image_url: msg.image_url || null,
      }),
    })
  }

  const copyMessage = (id: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  const stopGeneration = () => {
    abortControllerRef.current?.abort()
    setIsSending(false)
    setLoading(false)
  }

  const doSend = async (msgContent: string, msgId: string, convToUse: ChatConversation, prevChats: ChatConversation[], imageUrl?: string) => {
    const isFirstMsg = convToUse.messages.length === 0
    const title = isFirstMsg ? msgContent.slice(0, 40) : convToUse.title
    setFollowUpSuggestions([])
    setIssueDraft(null)

    const userMsg: ChatMessage = {
      id: msgId,
      role: 'user',
      content: msgContent,
      ts: Date.now(),
      image_url: imageUrl || undefined,
    }
    setLastUserMsg(userMsg)

    const updatedChats = prevChats.map(c =>
      c.id === convToUse.id
        ? { ...c, messages: [...c.messages, userMsg], title, updatedAt: Date.now() }
        : c
    )
    setChats(updatedChats)

    await persistMessage(convToUse.id, userMsg)
    if (isFirstMsg) {
      await fetch('/api/chat/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: convToUse.id, title }),
      })
    }

    setLoading(true)
    setIsSending(true)
    setChatError(null)
    const abortCtrl = new AbortController()
    abortControllerRef.current = abortCtrl
    try {
      // Feature 5: prepend system prompt if set
      const systemPrompt = convToUse.system_prompt
      const historyMessages = [...convToUse.messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }))
      const allMessages = systemPrompt
        ? [{ role: 'system', content: systemPrompt }, ...historyMessages]
        : historyMessages

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: convToUse.id, messages: allMessages, agentId: selectedAgent, modelOverride: selectedModel !== 'default' ? selectedModel : undefined }),
        signal: abortCtrl.signal,
      })

      if (!res.ok || !res.body) {
        setChatError('Gateway error — could not stream response')
        setLoading(false)
        setIsSending(false)
        return
      }

      const streamMsgId = 'msg-stream-' + Date.now()
      const placeholderMsg: ChatMessage = {
        id: streamMsgId,
        role: 'assistant',
        content: '',
        model: 'kaos',
        ts: Date.now(),
        agent_id: selectedAgent,
      }

      setChats(prev => prev.map(c =>
        c.id === convToUse.id
          ? { ...c, messages: [...c.messages, placeholderMsg], updatedAt: Date.now() }
          : c
      ))
      setLoading(false)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''
      let finalId = streamMsgId
      let streamThinking = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          try {
            const parsed = JSON.parse(raw)
            if (parsed.error) {
              setChatError(parsed.error)
              break
            }
            if (parsed.done) {
              finalId = parsed.id || streamMsgId
              if (parsed.issue_draft) setIssueDraft(parsed.issue_draft)
              break
            }
            // Tool call visibility: detect tool_use events
            if (parsed.tool_use) {
              const tu = parsed.tool_use
              setToolIndicators(prev => ({
                ...prev,
                [streamMsgId]: [...(prev[streamMsgId] || []), { name: tu.name || 'unknown', input: JSON.stringify(tu.input || {}), expanded: false }]
              }))
            }
            // Also detect tool_use wrapped in delta content blocks
            if (parsed.choices?.[0]?.delta?.content && typeof parsed.choices[0].delta.content === 'string') {
              try {
                const inner = JSON.parse(parsed.choices[0].delta.content)
                if (inner?.type === 'tool_use') {
                  setToolIndicators(prev => ({
                    ...prev,
                    [streamMsgId]: [...(prev[streamMsgId] || []), { name: inner.name || 'unknown', input: JSON.stringify(inner.input || {}), expanded: false }]
                  }))
                }
              } catch { /* not JSON */ }
            }
            // Tool result: capture output for tool calls
            if (parsed.tool_result) {
              const tr = parsed.tool_result
              setToolIndicators(prev => {
                const existing = prev[streamMsgId] || []
                // Attach output to the last tool indicator (most recent tool call)
                if (existing.length > 0) {
                  const updated = [...existing]
                  const last = updated[updated.length - 1]
                  updated[updated.length - 1] = { ...last, output: typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output || tr.content || '') }
                  return { ...prev, [streamMsgId]: updated }
                }
                return prev
              })
            }
            // Reasoning/thinking blocks
            const thinkingDelta = parsed.choices?.[0]?.delta?.thinking || parsed.thinking
            if (thinkingDelta) {
              streamThinking += thinkingDelta
            }
            if (parsed.delta) {
              fullContent += parsed.delta
              setChats(prev => prev.map(c =>
                c.id === convToUse.id
                  ? {
                      ...c,
                      messages: c.messages.map(m =>
                        m.id === streamMsgId ? { ...m, content: fullContent } : m
                      ),
                    }
                  : c
              ))
            }
          } catch { /* skip bad lines */ }
        }
      }

      // Store thinking content if any
      if (streamThinking) {
        setThinkingContent(prev => ({ ...prev, [finalId !== streamMsgId ? finalId : streamMsgId]: streamThinking }))
      }

      // Feature 7: mark unread if document not visible
      if (document.hidden) {
        setUnreadChat(true)
        unreadChatRef.current = true
        window.dispatchEvent(new CustomEvent('mc-chat-unread'))
      }

      if (finalId !== streamMsgId) {
        // Migrate tool indicators and thinking to new id
        setToolIndicators(prev => {
          if (!prev[streamMsgId]) return prev
          const { [streamMsgId]: old, ...rest } = prev
          return { ...rest, [finalId]: old }
        })
        if (streamThinking) {
          setThinkingContent(prev => {
            const { [streamMsgId]: old, ...rest } = prev
            return { ...rest, [finalId]: old }
          })
        }
        setChats(prev => prev.map(c =>
          c.id === convToUse.id
            ? { ...c, messages: c.messages.map(m => m.id === streamMsgId ? { ...m, id: finalId } : m) }
            : c
        ))
      }

      // Feature 13: generate follow-up suggestions after streaming completes
      if (fullContent) {
        setFollowUpSuggestions(generateSuggestions(fullContent))
      }

      // Feature 17: auto-title for new conversations
      if (isFirstMsg && msgContent) {
        triggerAutoTitle(convToUse.id, msgContent)
      }

    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setChatError('Network error — could not reach LLM')
      }
      setLoading(false)
    } finally {
      setIsSending(false)
      abortControllerRef.current = null
    }
  }

  const handleSend = async () => {
    if (!inputVal.trim() || !activeConv) return

    // Handle /imagine typed manually
    if (inputVal.trim().startsWith('/imagine ')) {
      await executeSlashCommand('/imagine')
      return
    }

    // Handle slash commands — match exact OR first filtered result from palette
    if (inputVal.startsWith('/')) {
      const typed = inputVal.trim().split(' ')[0]
      const exact = SLASH_COMMANDS.find(c => c.cmd === typed)
      if (exact) { await executeSlashCommand(typed); return }
      // Partial match: if palette is open and exactly one match (or first match), execute or insert
      const filtered = SLASH_COMMANDS.filter(c => c.cmd.startsWith(typed))
      if (filtered.length >= 1 && showSlashPalette) {
        const chosen = filtered[slashPaletteIdx] || filtered[0]
        if (chosen.cmd === '/imagine') {
          setInputVal('/imagine ')
          setShowSlashPalette(false)
          setTimeout(() => textareaRef.current?.focus(), 0)
          return
        }
        await executeSlashCommand(chosen.cmd)
        return
      }
    }

    setFollowUpSuggestions([])
    const MAX_FILE = 32768
    const fileContent = selectedFile
      ? (selectedFile.content.length > MAX_FILE ? selectedFile.content.slice(0, MAX_FILE) + '\n\n[...truncated at 32KB]' : selectedFile.content)
      : null
    // Feature 1: include pasted image
    let content = fileContent
      ? `[📎 ${selectedFile!.name}]\n\n${fileContent}\n\n---\n${inputVal}`
      : inputVal
    let imageUrl: string|undefined
    if (pastedImage) {
      content = `![image](${pastedImage})\n\n${content}`
      imageUrl = pastedImage
      setPastedImage(null)
    }
    // URL image input
    if (imageUrlPreview) {
      content = `![image](${imageUrlPreview})\n\n${content}`
      setImageUrlPreview(null)
      setImageUrlDraft('')
      setShowImageUrlInput(false)
    }
    const msgId = 'msg-' + Date.now()
    setInputVal('')
    setShowSlashPalette(false)
    setSelectedFile(null)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    await doSend(content, msgId, activeConv, chats, imageUrl)
  }

  const handleRetry = async () => {
    if (!lastUserMsg || !activeConv) return
    setChatError(null)
    const convWithoutLast = {
      ...activeConv,
      messages: activeConv.messages.filter(m => m.id !== lastUserMsg.id),
    }
    await doSend(lastUserMsg.content, 'msg-retry-' + Date.now(), convWithoutLast, chats)
  }

  // Feature 6: edit message
  const startEditMessage = (msg: ChatMessage) => {
    setEditingMsgId(msg.id)
    setEditingMsgContent(msg.content)
  }

  const confirmEditMessage = async (msg: ChatMessage) => {
    if (!activeConv || !editingMsgContent.trim()) return
    const editedContent = editingMsgContent.trim()
    const msgTs = msg.ts || Date.now()

    // Remove all messages at or after this message
    const newMessages = activeConv.messages.filter(m => (m.ts || 0) < msgTs)
    const updatedConv = { ...activeConv, messages: newMessages }
    setChats(prev => prev.map(c => c.id === activeConv.id ? updatedConv : c))
    setEditingMsgId(null)

    // Delete from Supabase
    await fetch(`/api/chat/messages?conversation_id=${activeConv.id}&after_ts=${msgTs}`, {
      method: 'DELETE',
    })

    // Re-send the edited message
    await doSend(editedContent, 'msg-edit-' + Date.now(), updatedConv, chats.map(c => c.id === activeConv.id ? updatedConv : c))
  }

  // Feature 11: voice input
  const toggleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return
    if (isListening) {
      speechRecognitionRef.current?.stop()
      setIsListening(false)
      return
    }
    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript
      setInputVal(prev => prev ? prev + ' ' + transcript : transcript)
    }
    recognition.onend = () => setIsListening(false)
    recognition.onerror = () => setIsListening(false)
    speechRecognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }

  // Feature 12: full-text search
  const doMessageSearch = async (q: string) => {
    if (q.length < 3) return
    setIsSearching(true)
    try {
      const res = await fetch(`/api/chat/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setSearchResults(data)
      setSearchMode('messages')
    } catch { /* ignore */ }
    finally { setIsSearching(false) }
  }

  // Feature 13: generate follow-up suggestions
  const generateSuggestions = (text: string) => {
    const last200 = text.slice(-200)
    const words = last200.toLowerCase().split(/\W+/).filter(w => w.length > 4)
    const stopWords = new Set(['about','would','should','could','their','there','where','which','these','those','other','after','before','while'])
    const nouns = words.filter(w => !stopWords.has(w)).slice(0, 10)
    const unique = Array.from(new Set(nouns)).slice(0, 4)
    const suggestions: string[] = []
    if (unique[0]) suggestions.push(`Tell me more about ${unique[0]}`)
    if (unique[1]) suggestions.push(`How do I ${unique[1]}?`)
    return suggestions.slice(0, 2)
  }

  // Feature 16: toggle bookmark
  const toggleBookmark = async (msgId: string, current: boolean) => {
    const newVal = !current
    setChats(prev => prev.map(c => c.id === activeChat
      ? { ...c, messages: c.messages.map(m => m.id === msgId ? { ...m, bookmarked: newVal } : m) }
      : c
    ))
    await fetch('/api/chat/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: msgId, bookmarked: newVal }),
    })
  }

  // Feature 17: auto-title
  const triggerAutoTitle = (conversationId: string, firstUserMessage: string) => {
    fetch('/api/chat/autotitle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, firstUserMessage }),
    }).then(r => r.json()).then(data => {
      if (data.title) {
        setChats(prev => prev.map(c => c.id === conversationId ? { ...c, title: data.title } : c))
      }
    }).catch(() => {})
  }

  // Feature 18: export helpers
  const exportChatMarkdown = (conv: ChatConversation): string => {
    const md = conv.messages.map(m =>
      `### ${m.role === 'user' ? '👤 You' : '🧠 KAOS'}${m.ts ? ` — ${new Date(m.ts).toLocaleTimeString()}` : ''}\n\n${m.content}`
    ).join('\n\n---\n\n')
    return `# ${conv.title}\n\n${md}`
  }

  const copyConvAsMarkdown = (conv: ChatConversation) => {
    navigator.clipboard.writeText(exportChatMarkdown(conv))
    setShowExportMenu(false)
  }

  const downloadConvMd = (conv: ChatConversation) => {
    const blob = new Blob([exportChatMarkdown(conv)], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${conv.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`
    a.click()
    URL.revokeObjectURL(url)
    setShowExportMenu(false)
  }

  const printConv = () => {
    printRef.current = true
    setShowExportMenu(false)
    setTimeout(() => { window.print(); printRef.current = false }, 100)
  }

  // Feature 19: fork conversation
  const forkConversation = async (conv: ChatConversation, upToMsgId: string) => {
    const msgIdx = conv.messages.findIndex(m => m.id === upToMsgId)
    const messagesToCopy = conv.messages.slice(0, msgIdx + 1)
    const newId = 'chat-fork-' + Date.now()
    const newTitle = `Fork of: ${conv.title}`
    const newConv: ChatConversation = {
      id: newId,
      title: newTitle,
      model: conv.model,
      messages: messagesToCopy.map(m => ({ ...m, id: 'msg-fork-' + Date.now() + Math.random().toString(36).slice(2) })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      project: conv.project,
      agent_id: conv.agent_id,
      system_prompt: conv.system_prompt,
      forked_from: conv.id,
    }
    setChats(prev => [newConv, ...prev])
    setActiveChat(newId)
    // Persist
    await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: newId, title: newTitle, model: conv.model, agent_id: conv.agent_id, forked_from: conv.id }),
    })
    for (const m of newConv.messages) {
      await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m.id, conversation_id: newId, role: m.role, content: m.content, model: m.model || null }),
      })
    }
  }

  const handleFileAttach = (accept?: string) => {
    setShowFileTypePicker(false)
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept || FILE_TYPE_GROUPS[0].accept
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const text = await file.text()
      setSelectedFile({ name: file.name, content: text })
    }
    input.click()
  }

  // Close file type picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (fileTypePickerRef.current && !fileTypePickerRef.current.contains(e.target as Node)) {
        setShowFileTypePicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const groupedChats = groupChatsByDate(filteredChats)

  // Feature 8: model label
  const agentModelLabel = AGENT_MODEL_MAP[selectedAgent] || 'Claude Max'

  // NEW: Send last assistant message to another agent
  const sendToAgent = async (targetAgentId: string) => {
    if (!activeConv) return
    const lastAssistant = [...activeConv.messages].reverse().find(m => m.role === 'assistant')
    if (!lastAssistant) return
    setShowSendToAgent(false)
    try {
      const res = await fetch('/api/chat/send-to-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: targetAgentId, message: lastAssistant.content, sessionKey: `mc-send-${targetAgentId}-${activeConv.id}` }),
      })
      const data = await res.json()
      if (data.ok) {
        // Show a local info message
        const infoMsg: ChatMessage = {
          id: 'send-to-' + Date.now(),
          role: 'assistant',
          content: `↗ **Forwarded to ${AGENT_OPTIONS.find(a=>a.id===targetAgentId)?.label || targetAgentId}**\n\n${data.reply}`,
          ts: Date.now(),
        }
        setChats(prev => prev.map(c => c.id === activeConv.id ? { ...c, messages: [...c.messages, infoMsg] } : c))
      }
    } catch { /* ignore */ }
  }

  return (
    <div className="flex gap-0 h-[calc(100vh-88px)] -mx-3 md:-mx-6 -my-5">
      {/* LEFT SIDEBAR — Feature 10: collapsible, hidden on mobile */}
      <div
        className={'shrink-0 border-r border-white/10 hidden md:flex flex-col transition-all duration-200 ' + (sidebarCollapsed ? 'w-10' : 'w-64')}
        style={{background:'#0d0d0d'}}
        ref={sidebarRef}
      >
        {sidebarCollapsed ? (
          /* Collapsed strip */
          <div className="flex flex-col items-center py-2 gap-2">
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white transition-colors text-sm"
              title="Expand sidebar">
              ›
            </button>
            <button
              onClick={newChat}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/15 transition-all text-xs"
              title="New Chat">
              +
            </button>
            {/* Unread dot on nav */}
            {unreadChat && (
              <span className="w-2 h-2 rounded-full bg-red-500" title="Unread messages" />
            )}
            {/* Conversation dots */}
            <div className="flex flex-col gap-1 mt-1">
              {filteredChats.slice(0, 8).map(c => (
                <button
                  key={c.id}
                  onClick={() => setActiveChat(c.id)}
                  title={c.title}
                  className={'w-6 h-6 rounded-full flex items-center justify-center text-[10px] transition-all ' +
                    (activeChat === c.id ? 'bg-white/10' : 'bg-[#0f0f0f] hover:bg-white/10')}>
                  {AGENT_BADGE_MAP[c.agent_id || 'main'] || '💬'}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Sidebar header with collapse button */}
            <div className="px-3 py-3 border-b border-white/10 flex items-center gap-2">
              <button
                onClick={newChat}
                className="flex-1 px-3 py-2 rounded-lg bg-white/10 text-white text-xs font-medium hover:bg-white/15 transition-all flex items-center gap-2">
                <span>+</span> New Chat
              </button>
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white transition-colors text-sm rounded-lg hover:bg-white/10"
                title="Collapse sidebar">
                ‹
              </button>
            </div>

            {/* Sidebar tabs: Mine / Heartbeats */}
            <div className="flex border-b border-white/10 shrink-0">
              {([['mine','💬','Mine'],['heartbeats','⏱','Beats']] as const).map(([id,icon,label])=>(
                <button key={id} onClick={()=>setSidebarTab(id)}
                  className={'flex-1 py-2 text-[10px] font-semibold tracking-wide transition-colors flex flex-col items-center gap-0.5 ' +
                    (sidebarTab===id ? 'text-white border-b-2 border-purple-500' : 'text-white/30 hover:text-white/40 border-b-2 border-transparent')}>
                  <span>{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {/* Feature 9 + 16: Project filter pills + Starred */}
            {sidebarTab === 'mine' && <div className="px-3 py-2 border-b border-white/10 flex flex-wrap gap-1">
              <button
                onClick={() => { setProjectFilter(null); setStarredFilter(false) }}
                className={'text-[9px] px-2 py-0.5 rounded-full border transition-colors ' +
                  (!projectFilter && !starredFilter ? 'bg-white/15 text-white border-white/20' : 'text-white/50 border-white/10 hover:border-white/10')}>
                All
              </button>
              {Object.entries(PROJECT_TAG_COLORS).map(([proj, color]) => (
                <button
                  key={proj}
                  onClick={() => { setProjectFilter(projectFilter === proj ? null : proj); setStarredFilter(false) }}
                  className={'text-[9px] px-2 py-0.5 rounded-full border transition-colors ' +
                    (projectFilter === proj ? 'text-white' : 'text-white/50 hover:text-white/70')}
                  style={projectFilter === proj
                    ? { background: color + '30', borderColor: color + '80', color }
                    : { borderColor: '#27272a' }}>
                  {proj}
                </button>
              ))}
              <button
                onClick={() => { setStarredFilter(v => !v); setProjectFilter(null) }}
                className={'text-[9px] px-2 py-0.5 rounded-full border transition-colors ' +
                  (starredFilter ? 'bg-yellow-900/40 text-yellow-400 border-yellow-700/50' : 'text-white/50 border-white/10 hover:border-white/10')}>
                ⭐ Starred
              </button>
            </div>}

            {/* Feature 12: Search + message search */}
            {sidebarTab === 'mine' && <>
            <div className="px-3 py-2.5 border-b border-white/10">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10" style={{background:'#111'}}>
                <svg className="w-3 h-3 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    if (searchMode === 'messages') { setSearchMode('title'); setSearchResults([]) }
                  }}
                  className="bg-transparent text-xs text-white/70 placeholder-white/30 w-full outline-none"
                />
                {searchMode === 'messages' && (
                  <button onClick={() => { setSearchMode('title'); setSearchResults([]) }} className="text-[9px] text-yellow-400 hover:text-yellow-200">✕</button>
                )}
              </div>
              {search.length >= 3 && searchMode === 'title' && (
                <button
                  onClick={() => doMessageSearch(search)}
                  disabled={isSearching}
                  className="mt-1.5 w-full text-[9px] px-2 py-1 rounded-lg border border-white/10 text-white/50 hover:text-white/70 hover:border-white/20 transition-colors text-left flex items-center gap-1.5">
                  {isSearching ? '⟳ Searching messages...' : '🔍 Search message content'}
                </button>
              )}
              {searchMode === 'messages' && searchResults.length > 0 && (
                <p className="mt-1 text-[9px] text-white/30">{searchResults.length} message{searchResults.length !== 1 ? 's' : ''} found</p>
              )}
            </div>

            {/* Grouped Chats */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {filteredChats.length === 0 ? (
                <p className="text-white/20 text-xs px-3 py-4">No chats yet</p>
              ) : (
                groupedChats.map(group => (
                  <div key={group.label} className="mb-2">
                    <p className={'text-[9px] uppercase tracking-widest font-semibold px-3 py-1.5 ' + (group.pinned ? 'text-amber-600' : 'text-white/20')}>
                      {group.pinned ? '📌 ' : ''}{group.label}
                    </p>
                    <div className="space-y-0.5">
                      {group.items.map(c => {
                        const flatIdx = filteredChats.indexOf(c)
                        const lastMsg = c.messages[c.messages.length - 1]
                        const preview = searchMode === 'messages'
                          ? searchResults.find(r => r.conversation_id === c.id)?.content.slice(0, 60)
                          : lastMsg ? stripMarkdownPreview(lastMsg.content) : ''
                        const agentBadge = AGENT_BADGE_MAP[c.agent_id || 'main'] || '🧠'
                        const projColor = c.project ? PROJECT_TAG_COLORS[c.project] : null
                        const highlightedPreview = searchMode === 'messages' && preview && search.length >= 3
                          ? (() => {
                              const idx = preview.toLowerCase().indexOf(search.toLowerCase())
                              if (idx < 0) return <span>{preview}</span>
                              return <span>{preview.slice(0, idx)}<span className="bg-yellow-900/40 text-yellow-300">{preview.slice(idx, idx + search.length)}</span>{preview.slice(idx + search.length)}</span>
                            })()
                          : <span>{preview}</span>
                        return (
                          <div
                            key={c.id}
                            className={
                              'group relative w-full text-left px-3 py-2.5 rounded-lg transition-all text-xs cursor-pointer ' +
                              (activeChat === c.id ? 'bg-white/10 text-white' : sidebarFocusIdx === flatIdx ? 'bg-[#0f0f0f]/70 text-white/70 ring-1 ring-white/10' : 'text-white/40 hover:text-white/70 hover:bg-[#0f0f0f]')
                            }
                            onClick={() => { setActiveChat(c.id); setSidebarFocusIdx(flatIdx) }}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              togglePin(c.id, !c.pinned)
                            }}
                          >
                            {/* MC-150: agent badge + double-click inline rename */}
                            <div className="flex items-center justify-between gap-1">
                              {renamingTitle !== null && activeChat === c.id ? (
                                <input
                                  autoFocus
                                  value={renamingTitle}
                                  onChange={e => setRenamingTitle(e.target.value)}
                                  onBlur={() => renameChat(c.id, renamingTitle)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') renameChat(c.id, renamingTitle)
                                    if (e.key === 'Escape') setRenamingTitle(null)
                                  }}
                                  onClick={e => e.stopPropagation()}
                                  className="flex-1 bg-transparent border-b border-purple-500/50 text-white text-xs font-medium outline-none px-0 py-0 min-w-0"
                                  style={{ lineHeight: '1.4' }}
                                />
                              ) : (
                              <p
                                className="font-medium truncate flex-1 pr-1"
                                title="Double-click to rename"
                                onDoubleClick={(e) => {
                                  e.stopPropagation()
                                  setActiveChat(c.id)
                                  setRenamingTitle(c.title)
                                }}>
                                {c.pinned ? '📌 ' : ''}{c.title}
                              </p>
                              )}
                              <div className="flex items-center gap-1 shrink-0">
                                {/* Feature 19: forked badge */}
                                {c.forked_from && <span className="text-[9px] text-white/30" title="Forked conversation">⑂</span>}
                                <span className="text-[10px] opacity-70">{agentBadge}</span>
                              </div>
                            </div>
                            {/* Feature 2: last message preview */}
                            {preview && (
                              <p className="text-white/30 text-[9px] truncate mt-0.5">{highlightedPreview}</p>
                            )}
                            <div className="flex items-center justify-between mt-0.5">
                              <p className="text-[9px] opacity-40">
                                {new Date(c.updatedAt).toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'})}
                              </p>
                              {/* Feature 9: project pill */}
                              {c.project && projColor && (
                                <span
                                  className="text-[8px] px-1.5 py-0 rounded-full"
                                  style={{ background: projColor + '20', color: projColor }}>
                                  {c.project}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteChat(c.id) }}
                              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all text-[10px] p-0.5"
                              title="Delete">
                              ✕
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
            </>}

            {/* Heartbeats tab content */}
            {sidebarTab === 'heartbeats' && (
              <div className="flex-1 overflow-y-auto">
                {ocLoading && <div className="p-4 text-center text-white/30 text-xs">Loading…</div>}
                {!ocLoading && (() => {
                  const items = ocSessions.filter(s => s.action === 'cron' || s.channel?.includes('Cron'))
                  if (items.length === 0) return <div className="p-4 text-center text-white/30 text-xs">No sessions found</div>
                  return items.map((s: any, i: number) => (
                    <div key={i} className="px-3 py-2.5 border-b border-white/10 hover:bg-[#0f0f0f]/50 cursor-default">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-base">{s.emoji || '🤖'}</span>
                        <span className="text-xs font-semibold text-white/70">{s.agentName || s.agentId}</span>
                        <span className="ml-auto text-[9px] text-white/30">{s.ago != null ? `${s.ago}m ago` : ''}</span>
                      </div>
                      <div className="flex items-center gap-2 pl-7">
                        <span className="text-[10px] text-white/50">{s.channel}</span>
                        {s.tokens > 0 && <span className="text-[9px] text-white/20">{(s.tokens/1000).toFixed(1)}k tokens</span>}
                      </div>
                    </div>
                  ))
                })()}
              </div>
            )}
          </>
        )}
      </div>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="w-72 bg-[#0d0d0d] border-r border-white/10 flex flex-col h-full overflow-y-auto">
            <div className="px-3 py-3 border-b border-white/10 flex items-center gap-2">
              <button onClick={newChat} className="flex-1 px-3 py-2 rounded-lg bg-white/10 text-white text-xs font-medium hover:bg-white/15 transition-all flex items-center gap-2">
                <span>+</span> New Chat
              </button>
              <button onClick={() => setMobileSidebarOpen(false)} className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white transition-colors text-sm rounded-lg hover:bg-white/10">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {filteredChats.length === 0 ? (
                <p className="text-white/20 text-xs px-3 py-4">No chats yet</p>
              ) : (
                filteredChats.map(c => (
                  <div
                    key={c.id}
                    className={'w-full text-left px-3 py-2.5 rounded-lg transition-all text-xs cursor-pointer mb-0.5 ' +
                      (activeChat === c.id ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70 hover:bg-[#0f0f0f]')}
                    onClick={() => { setActiveChat(c.id); setMobileSidebarOpen(false) }}>
                    <p className="font-medium truncate">{c.pinned ? '📌 ' : ''}{c.title}</p>
                    <p className="text-[9px] opacity-40 mt-0.5">{new Date(c.updatedAt).toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'})}</p>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="flex-1 bg-black/60" onClick={() => setMobileSidebarOpen(false)} />
        </div>
      )}

      {/* CENTER: CHAT AREA */}
      <div className="flex-1 flex flex-col min-w-0 relative" style={{background:'#080808'}}>
        {!activeConv ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="text-center">
              <div className="text-5xl mb-4">💬</div>
              <p className="text-white/40 text-sm font-medium">No conversation selected</p>
              <p className="text-white/20 text-xs mt-1">Click "New Chat" to start</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="border-b border-white/10 px-3 md:px-6 py-3 shrink-0 flex items-center justify-between gap-3">
              <button onClick={() => setMobileSidebarOpen(true)} className="md:hidden shrink-0 p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors text-sm" title="History">☰</button>
              <div className="flex-1 min-w-0">
                {renamingTitle !== null ? (
                  <input
                    autoFocus
                    value={renamingTitle}
                    onChange={e => setRenamingTitle(e.target.value)}
                    onBlur={() => renameChat(activeConv.id, renamingTitle)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') renameChat(activeConv.id, renamingTitle)
                      if (e.key === 'Escape') setRenamingTitle(null)
                    }}
                    className="bg-transparent border-b border-white/20 text-white text-sm font-medium outline-none w-full"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <h2
                      className="text-white text-sm font-medium truncate cursor-pointer hover:text-white/70 transition-colors"
                      title="Double-click to rename"
                      onDoubleClick={() => setRenamingTitle(activeConv.title)}>
                      {activeConv.title}
                    </h2>
                    {/* Feature 9: project badge in header */}
                    <button
                      onClick={() => {
                        const current = activeConv.project || null
                        const idx = PROJECT_CYCLE.indexOf(current as any)
                        const next = PROJECT_CYCLE[(idx + 1) % PROJECT_CYCLE.length]
                        setConvProject(activeConv.id, next)
                      }}
                      className="text-[9px] px-2 py-0.5 rounded-full border transition-colors shrink-0"
                      style={activeConv.project
                        ? { background: (PROJECT_TAG_COLORS[activeConv.project] || '#555') + '20', color: PROJECT_TAG_COLORS[activeConv.project] || '#aaa', borderColor: (PROJECT_TAG_COLORS[activeConv.project] || '#555') + '50' }
                        : { color: '#555', borderColor: '#2a2a2a', background: '#141414' }}
                      title="Click to cycle project tag">
                      {activeConv.project || '+ project'}
                    </button>
                  </div>
                )}
                {/* INF-83: Model selector pill + Feature 15: context budget */}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold"
                    style={{background:'#1a1a2e',borderColor:'#3b3b6a',color:'#a29bfe'}}>
                    <span>{currentAgent.label.split(' ')[0]}</span>
                    <span className="text-white/30">·</span>
                    <span style={{color:'#818cf8'}}>{agentModelLabel}</span>
                  </span>
                  {selectedModel !== 'default' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[9px] font-medium"
                      style={{background:'#0f1a0f',borderColor:'#1a3a1a',color:'#34d399'}}>
                      {MODEL_OPTIONS.find(m=>m.id===selectedModel)?.label.replace(/^[^ ]+ /,'') || selectedModel}
                    </span>
                  )}
                  {activeConv.messages.length > 0 && (
                    <span className={`text-[9px] tabular-nums ${contextTokenColor}`}>{contextTokenLabel}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {/* Feature 20: session context viewer button */}
                <div className="hidden md:block relative">
                  <button
                    onClick={() => { setShowContextViewer(v => !v); setShowSystemPrompt(false) }}
                    className={'text-[10px] px-2.5 py-1 rounded-lg border transition-colors font-mono ' +
                      (showContextViewer ? 'text-emerald-300 border-emerald-800 bg-emerald-900/20' : 'text-white/50 border-white/10 hover:text-white/70 hover:border-white/20')}
                    title="Session context">
                    {'{ }'}
                  </button>
                  {showContextViewer && (
                    <div className="absolute right-0 top-8 z-20 w-72 rounded-xl border border-white/10 shadow-2xl p-3 space-y-1.5" style={{background:'#0f0f0f'}}>
                      <p className="text-[10px] text-white/50 uppercase tracking-widest font-semibold mb-2">Session Context</p>
                      {[
                        ['Session key', `mc-chat-${activeConv.id}`],
                        ['Agent', `${selectedAgent} (${currentAgent.label})`],
                        ['Model', agentModelLabel],
                        ['Messages', String(activeConv.messages.length)],
                        ['Est. tokens', contextTokenLabel],
                        ['System prompt', activeConv.system_prompt ? activeConv.system_prompt.slice(0, 100) + (activeConv.system_prompt.length > 100 ? '…' : '') : 'none'],
                        ['Forked from', activeConv.forked_from || 'original'],
                      ].map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <span className="text-[9px] text-white/30 w-24 shrink-0">{k}</span>
                          <span className="text-[9px] text-white/40 break-all">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Feature 5: system prompt gear button */}
                <div className="hidden md:block relative">
                  <button
                    onClick={() => { setShowSystemPrompt(v => !v); setShowContextViewer(false) }}
                    className={'text-[10px] px-2.5 py-1 rounded-lg border transition-colors flex items-center gap-1 ' +
                      (showSystemPrompt ? 'text-blue-300 border-blue-800 bg-blue-900/30' : 'text-white/50 border-white/10 hover:text-white/70 hover:border-white/20')}
                    title="System prompt">
                    ⚙️
                    {activeConv.system_prompt && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                    )}
                  </button>
                  {showSystemPrompt && (
                    <div className="absolute right-0 top-8 z-20 w-80 rounded-xl border border-white/10 shadow-2xl p-3 space-y-2" style={{background:'#0f0f0f'}}>
                      <p className="text-[10px] text-white/50 uppercase tracking-widest font-semibold">System Prompt</p>
                      <textarea
                        rows={4}
                        value={systemPromptDraft}
                        onChange={e => setSystemPromptDraft(e.target.value)}
                        onBlur={() => saveSystemPrompt(activeConv.id, systemPromptDraft)}
                        placeholder="Optional system prompt for this conversation..."
                        className="w-full bg-[#0f0f0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white/70 placeholder-white/30 outline-none focus:border-white/20 resize-none"
                      />
                      <p className="text-[9px] text-white/20">Auto-saves on blur. Prepended to every message in this conversation.</p>
                    </div>
                  )}
                </div>
                {/* NEW: Send-to-agent */}
                <div className="hidden md:block relative" ref={sendToAgentRef}>
                  <button
                    onClick={() => setShowSendToAgent(v => !v)}
                    className="text-[10px] px-2.5 py-1 rounded-lg text-white/50 hover:text-white/70 border border-white/10 hover:border-white/20 transition-colors flex items-center gap-1"
                    title="Forward last message to another agent">
                    ↗ Send to
                    <span className="text-[8px]">▾</span>
                  </button>
                  {showSendToAgent && (
                    <div className="absolute right-0 top-7 z-30 w-48 rounded-xl border border-white/10 shadow-2xl py-1" style={{background:'#0f0f0f'}}>
                      {AGENT_OPTIONS.filter(a => a.id !== selectedAgent).map(a => (
                        <button
                          key={a.id}
                          onClick={() => sendToAgent(a.id)}
                          className="w-full text-left px-3 py-1.5 text-[11px] text-white/40 hover:text-white hover:bg-white/10/60 transition-colors">
                          {a.label} <span className="text-white/30 text-[9px]">{a.desc}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {isSending ? (
                  <button
                    onClick={stopGeneration}
                    className="text-[10px] px-2.5 py-1 rounded-lg bg-red-900/40 hover:bg-red-900/70 text-red-300 border border-red-800/50 transition-colors flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-sm bg-red-400 inline-block" />
                    Stop
                  </button>
                ) : (
                  /* Feature 18: export dropdown */
                  <div className="hidden md:block relative" ref={exportMenuRef}>
                    <button
                      onClick={() => setShowExportMenu(v => !v)}
                      className="text-[10px] px-2.5 py-1 rounded-lg text-white/50 hover:text-white/70 border border-white/10 hover:border-white/20 transition-colors flex items-center gap-1">
                      ↓ Export
                      <span className="text-[8px]">▾</span>
                    </button>
                    {showExportMenu && (
                      <div className="absolute right-0 top-7 z-30 w-44 rounded-xl border border-white/10 shadow-2xl py-1" style={{background:'#0f0f0f'}}>
                        <button
                          onClick={() => copyConvAsMarkdown(activeConv)}
                          className="w-full text-left px-3 py-1.5 text-[11px] text-white/40 hover:text-white hover:bg-white/10/60 transition-colors">
                          ⎘ Copy as Markdown
                        </button>
                        <button
                          onClick={() => downloadConvMd(activeConv)}
                          className="w-full text-left px-3 py-1.5 text-[11px] text-white/40 hover:text-white hover:bg-white/10/60 transition-colors">
                          ↓ Download .md
                        </button>
                        <button
                          onClick={printConv}
                          className="w-full text-left px-3 py-1.5 text-[11px] text-white/40 hover:text-white hover:bg-white/10/60 transition-colors">
                          🖨 Print / PDF
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* KAOS is writing status bar */}
            {isSending && (
              <div className="border-b border-white/10 px-6 py-2 shrink-0 flex items-center gap-2.5" style={{background:'#0d0d0d'}}>
                <div className="flex gap-0.5 items-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{animationDelay:'0ms'}} />
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{animationDelay:'120ms'}} />
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{animationDelay:'240ms'}} />
                </div>
                <span className="text-xs text-white/50">🧠 <span className="text-blue-400 font-medium">{currentAgent.label}</span> is writing…</span>
              </div>
            )}

            {/* Messages */}
            <div
              ref={messagesContainerRef}
              className={`flex-1 overflow-y-auto px-3 md:px-6 py-4 space-y-4 relative print-chat`}
              onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true) }}
              onDragLeave={(e) => { if (!messagesContainerRef.current?.contains(e.relatedTarget as Node)) setIsDraggingOver(false) }}
              onDrop={(e) => {
                e.preventDefault()
                setIsDraggingOver(false)
                const file = e.dataTransfer.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = (ev) => {
                  const text = ev.target?.result as string
                  setSelectedFile({ name: file.name, content: text })
                }
                reader.readAsText(file)
              }}
            >
              {/* Auto-scroll lock indicator */}
              {userScrolledUp && (
                <div className="absolute top-3 right-4 z-20 flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold pointer-events-none"
                  style={{background:'#78350f22', border:'1px solid #f59e0b55', color:'#f59e0b'}}>
                  🔒 scroll locked
                </div>
              )}

              {/* Drag overlay */}
              {isDraggingOver && (
                <div className="absolute inset-0 z-30 flex items-center justify-center rounded-lg pointer-events-none"
                  style={{ background: 'rgba(59,130,246,0.08)', border: '2px dashed #3b82f6' }}>
                  <div className="text-center">
                    <div className="text-3xl mb-2">📎</div>
                    <p className="text-blue-400 text-sm font-medium">Drop file to attach</p>
                  </div>
                </div>
              )}

              {activeConv.messages.length === 0 ? (
                <EmptyState icon="💬" message="No messages yet — start the conversation" />
              ) : (
                activeConv.messages.map(msg => {
                  // MC-37: Handoff indicator
                  if (msg.agent_id === '__handoff__') {
                    return (
                      <div key={msg.id} className="flex items-center gap-3 py-2">
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" />
                        <span className="text-[10px] text-blue-400/70 font-medium px-3 py-1 rounded-full border border-blue-500/20 bg-blue-500/5 whitespace-nowrap">
                          {msg.content.replace(/\*\*/g, '')}
                        </span>
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" />
                      </div>
                    )
                  }
                  const msgAgent = msg.agent_id || selectedAgent
                  return (
                  <div
                    key={msg.id}
                    className={'group flex gap-3 ' + (msg.role === 'user' ? 'flex-row-reverse' : '')}>
                    {/* Avatar */}
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm mt-0.5"
                      style={{ background: msg.role === 'user' ? '#1e1e1e' : '#3b82f620' }}>
                      {msg.role === 'user' ? '👤' : (AGENT_BADGE_MAP[msgAgent] || '🧠')}
                    </div>

                    {/* Bubble */}
                    <div className={'relative ' + (msg.role === 'user' ? 'max-w-[85%] md:max-w-[65ch]' : 'max-w-[85%] md:max-w-[75ch]')}>
                      {/* Feature 6: inline edit mode */}
                      {editingMsgId === msg.id ? (
                        <div className="flex flex-col gap-2">
                          <textarea
                            autoFocus
                            value={editingMsgContent}
                            onChange={e => setEditingMsgContent(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmEditMessage(msg) }
                              if (e.key === 'Escape') setEditingMsgId(null)
                            }}
                            className="px-4 py-3 rounded-lg bg-white/15 text-white text-sm outline-none border border-white/20 resize-none w-full"
                            rows={3}
                          />
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => setEditingMsgId(null)}
                              className="text-xs text-white/50 hover:text-white px-2 py-1 rounded-lg border border-white/10 hover:border-white/20 transition-colors">
                              Cancel
                            </button>
                            <button
                              onClick={() => confirmEditMessage(msg)}
                              className="text-xs text-white px-2 py-1 rounded-lg bg-white/15 hover:bg-white/10 border border-white/20 transition-colors">
                              ✓ Send
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* NEW: Tool call indicators above assistant messages */}
                          {msg.role === 'assistant' && toolIndicators[msg.id] && toolIndicators[msg.id].map((tool, ti) => (
                            <div key={ti} className="mb-2 rounded-lg border border-white/10/50 bg-[#080808] text-xs overflow-hidden">
                              <button
                                onClick={() => setToolIndicators(prev => ({
                                  ...prev,
                                  [msg.id]: prev[msg.id].map((t, i) => i === ti ? { ...t, expanded: !t.expanded } : t)
                                }))}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-white/40 hover:text-white/70 transition-colors text-left">
                                <span>🔧</span>
                                <span className="font-mono text-emerald-400">{tool.name}</span>
                                <span className="text-white/30 text-[9px] ml-auto">{tool.expanded ? '▲' : '▼'}</span>
                              </button>
                              {tool.expanded && (
                                <div className="px-3 pb-2 space-y-1">
                                  <div>
                                    <span className="text-[9px] text-white/30 uppercase tracking-wider">Input</span>
                                    <pre className="text-[10px] font-mono text-white/50 overflow-x-auto whitespace-pre-wrap break-words max-h-32">
                                      {tool.input}
                                    </pre>
                                  </div>
                                  {tool.output && (
                                    <div>
                                      <span className="text-[9px] text-white/30 uppercase tracking-wider">Output</span>
                                      <pre className="text-[10px] font-mono text-white/40 overflow-x-auto whitespace-pre-wrap break-words max-h-32">
                                        {tool.output}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                          {/* NEW: Thinking/reasoning panel above assistant message */}
                          {msg.role === 'assistant' && thinkingContent[msg.id] && (
                            <details className="mb-2 rounded-lg border border-white/10/50 overflow-hidden">
                              <summary className="px-3 py-1.5 text-[11px] text-white/50 cursor-pointer hover:text-white/70 transition-colors select-none" style={{background:'#161616'}}>
                                💭 Reasoning <span className="text-[9px] text-white/20">(click to expand)</span>
                              </summary>
                              <pre className="px-3 py-2 text-[10px] font-mono text-white/50 whitespace-pre-wrap break-words max-h-48 overflow-y-auto" style={{background:'#111'}}>
                                {thinkingContent[msg.id]}
                              </pre>
                            </details>
                          )}
                          {/* Feature 16: bookmarked gold left border */}
                          <div
                            className={
                              'message-bubble px-4 py-3 rounded-lg text-sm ' +
                              (msg.role === 'user' ? 'bg-white/10 text-white' : 'bg-[#0f0f0f] text-white/70') +
                              (msg.bookmarked ? ' border-l-2 border-yellow-600/50' : '')
                            }>
                            {/* Feature 1: show image if present */}
                            {msg.image_url && (
                              <img src={msg.image_url} alt="pasted" className="max-w-[200px] max-h-[150px] rounded-lg mb-2 object-contain" />
                            )}
                            {msg.role === 'user'
                              ? <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.content.replace(/^!\[image\]\(data:[^)]+\)\n\n/, '')}</p>
                              : <MarkdownMessage content={msg.content} />
                            }
                          </div>
                          {/* NEW: Approval flow buttons */}
                          {msg.role === 'assistant' && /\/approve\s+(allow-once|allow-always|deny)/i.test(msg.content) && !approvalUsed[msg.id] && (
                            <div className="flex gap-2 mt-2 flex-wrap">
                              {[
                                { label: '✓ Allow once', cmd: '/approve allow-once', cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/50 hover:bg-emerald-900/70' },
                                { label: '✓ Always',     cmd: '/approve allow-always', cls: 'bg-blue-900/40 text-blue-300 border-blue-800/50 hover:bg-blue-900/70' },
                                { label: '✗ Deny',       cmd: '/approve deny',         cls: 'bg-red-900/40 text-red-300 border-red-800/50 hover:bg-red-900/70' },
                              ].map(btn => (
                                <button
                                  key={btn.cmd}
                                  onClick={async () => {
                                    setApprovalUsed(prev => ({ ...prev, [msg.id]: true }))
                                    if (!activeConv) return
                                    const approvalMsgId = 'msg-approval-' + Date.now()
                                    await doSend(btn.cmd, approvalMsgId, activeConv, chats)
                                  }}
                                  className={`text-xs px-3 py-1 rounded-lg border transition-colors ${btn.cls}`}>
                                  {btn.label}
                                </button>
                              ))}
                            </div>
                          )}
                          {/* Actions row: copy + edit + bookmark + fork */}
                          <div className={
                            'flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ' +
                            (msg.role === 'user' ? 'justify-end' : 'justify-start')
                          }>
                            <button
                              onClick={() => copyMessage(msg.id, msg.content)}
                              className="text-[9px] p-1.5 rounded text-white/30 hover:text-white/40 flex items-center gap-1 transition-colors focus:outline-none focus:ring-1 focus:ring-white/20">
                              {copiedId === msg.id ? '✓ Copied' : '⎘ Copy'}
                            </button>
                            {/* Feature 16: bookmark */}
                            <button
                              onClick={() => toggleBookmark(msg.id, !!msg.bookmarked)}
                              className={'text-[9px] p-1.5 rounded transition-colors focus:outline-none focus:ring-1 focus:ring-white/20 ' + (msg.bookmarked ? 'text-yellow-500 hover:text-yellow-300' : 'text-white/30 hover:text-white/40')}
                              title={msg.bookmarked ? 'Remove bookmark' : 'Bookmark'}>
                              ★
                            </button>
                            {/* Fork: assistant messages (existing) + user messages (new task 6) */}
                            {activeConv && (
                              <button
                                onClick={() => forkConversation(activeConv, msg.id)}
                                className="text-[9px] p-1.5 rounded text-white/30 hover:text-white/40 transition-colors focus:outline-none focus:ring-1 focus:ring-white/20"
                                title="Fork conversation from here">
                                ⑂ Fork
                              </button>
                            )}
                            {/* Feature 6: edit button for user messages */}
                            {msg.role === 'user' && (
                              <button
                                onClick={() => startEditMessage(msg)}
                                className="text-[9px] p-1.5 rounded text-white/30 hover:text-white/40 transition-colors focus:outline-none focus:ring-1 focus:ring-white/20"
                                title="Edit message">
                                ✏️
                              </button>
                            )}
                            {/* Per-message delete */}
                            <button
                              onClick={() => {
                                if (!activeConv) return
                                setChats(prev => prev.map(c => c.id === activeConv.id
                                  ? { ...c, messages: c.messages.filter(m => m.id !== msg.id) }
                                  : c
                                ))
                                fetch(`/api/chat/messages?id=${msg.id}`, { method: 'DELETE' })
                              }}
                              className="text-[9px] p-1.5 rounded text-white/30 hover:text-red-400 transition-colors focus:outline-none focus:ring-1 focus:ring-white/20"
                              title="Delete message">
                              🗑
                            </button>
                          </div>
                          {/* Task 5: Timestamp on hover, shown below actions row */}
                          {msg.ts && (
                            <div className={
                              'opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 ' +
                              (msg.role === 'user' ? 'text-right' : 'text-left')
                            }>
                              <span className="text-[9px] text-white/20">
                                {new Date(msg.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
                              </span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  )
                })
              )}
              {/* MC-184: NL issue preview card */}
              {issueDraft && !isSending && (
                <div className="pl-11">
                  <IssuePreviewCard draft={issueDraft} project={selectedBusiness} />
                </div>
              )}
              {/* Feature 13: follow-up suggestions */}
              {followUpSuggestions.length > 0 && !isSending && (
                <div className="flex gap-2 flex-wrap pl-11">
                  {followUpSuggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => { setInputVal(s); textareaRef.current?.focus() }}
                      className="px-3 py-1 rounded-full border border-white/10 text-white/40 text-[11px] hover:bg-white/10 hover:text-white cursor-pointer transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {loading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm bg-[#0f0f0f]/50">
                    🧠
                  </div>
                  <div className="px-4 py-3 rounded-lg bg-[#0f0f0f] text-white/50">
                    <div className="flex gap-1 items-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{animationDelay:'0ms'}} />
                      <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{animationDelay:'150ms'}} />
                      <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{animationDelay:'300ms'}} />
                    </div>
                  </div>
                </div>
              )}
              {chatError && (
                <div className="flex gap-3">
                  <div className="px-4 py-3 rounded-lg bg-red-950/40 border border-red-900/40 text-red-400 text-sm max-w-xl flex items-center gap-3">
                    <span>⚠️ {chatError}</span>
                    <button
                      onClick={handleRetry}
                      className="ml-2 text-xs px-2.5 py-1 rounded-lg bg-red-900/40 hover:bg-red-900/70 text-red-300 border border-red-800/50 transition-colors shrink-0">
                      Retry ↺
                    </button>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* MC-159: Auto-scroll lock indicator + back to bottom */}
            {userScrolledUp && (
              <div className="absolute bottom-24 right-6 z-40 flex flex-col items-end gap-2">
                {/* Lock indicator pill */}
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium"
                  style={{ background: '#18181b', border: '1px solid #f59e0b88', color: '#fbbf24' }}>
                  <span>🔒</span>
                  <span>Auto-scroll paused</span>
                  {scrollLockState.missedMessages > 0 && (
                    <span className="ml-1 px-1.5 py-0 rounded-full text-[9px] font-bold" style={{ background: '#a855f7', color: '#fff' }}>
                      {scrollLockState.missedMessages} new
                    </span>
                  )}
                </div>
                <button
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold shadow-xl transition-all hover:scale-105"
                  style={{ background: '#18181b', border: '2px solid #a855f7', color: '#e4d4f4', boxShadow: '0 0 12px #a855f744' }}
                  onClick={() => {
                    setUserScrolledUp(false)
                    setScrollLockState(prev => ({ ...prev, locked: false, missedMessages: 0 }))
                    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
                  }}
                  title="Resume auto-scroll">
                  🔓 Resume scroll
                </button>
              </div>
            )}

            {/* Input Area */}
            <div className="border-t border-white/10 px-3 md:px-6 py-3 md:py-4 shrink-0" style={{background:'#0d0d0d', paddingBottom:'max(12px, env(safe-area-inset-bottom))'}}>
              {/* Feature 1: pasted image preview */}
              {pastedImage && (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0f0f0f] border border-white/10">
                  <img src={pastedImage} alt="paste preview" className="w-12 h-12 object-contain rounded" />
                  <span className="text-xs text-white/40 flex-1">Image pasted</span>
                  <button
                    onClick={() => setPastedImage(null)}
                    className="text-white/30 hover:text-white text-xs ml-1">
                    ✕
                  </button>
                </div>
              )}
              {/* MC-134: File type preview card on attach */}
              {selectedFile && (() => {
                const ext = selectedFile.name.split('.').pop()?.toLowerCase() || ''
                const FILE_ICON_MAP: Record<string, { icon: string; color: string; lang: string }> = {
                  ts: { icon: '🟦', color: '#3178c6', lang: 'TypeScript' },
                  tsx: { icon: '🟦', color: '#3178c6', lang: 'TypeScript React' },
                  js: { icon: '🟨', color: '#f7df1e', lang: 'JavaScript' },
                  jsx: { icon: '🟨', color: '#f7df1e', lang: 'JavaScript React' },
                  py: { icon: '🐍', color: '#3776ab', lang: 'Python' },
                  rs: { icon: '🦀', color: '#dea584', lang: 'Rust' },
                  go: { icon: '🔵', color: '#00add8', lang: 'Go' },
                  md: { icon: '📝', color: '#888', lang: 'Markdown' },
                  json: { icon: '📋', color: '#999', lang: 'JSON' },
                  css: { icon: '🎨', color: '#264de4', lang: 'CSS' },
                  html: { icon: '🌐', color: '#e34c26', lang: 'HTML' },
                  sql: { icon: '🗄️', color: '#336791', lang: 'SQL' },
                  yml: { icon: '⚙️', color: '#cb171e', lang: 'YAML' },
                  yaml: { icon: '⚙️', color: '#cb171e', lang: 'YAML' },
                  sh: { icon: '💻', color: '#89e051', lang: 'Shell' },
                  csv: { icon: '📊', color: '#217346', lang: 'CSV' },
                }
                const meta = FILE_ICON_MAP[ext] || { icon: '📄', color: '#888', lang: ext.toUpperCase() || 'Text' }
                const sizeKB = selectedFile.content.length / 1024
                const lineCount = selectedFile.content.split('\n').length
                const truncated = selectedFile.content.length > 32768
                return (
                  <div className="rounded-xl mb-2 overflow-hidden" style={{ border: `1px solid ${meta.color}40`, background: `${meta.color}08` }}>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0" style={{ background: `${meta.color}20` }}>
                        {meta.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white/80 text-xs font-medium truncate">{selectedFile.name}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[9px] px-1.5 py-0 rounded-full" style={{ background: `${meta.color}25`, color: meta.color }}>{meta.lang}</span>
                          <span className="text-white/30 text-[9px]">{sizeKB.toFixed(1)} KB</span>
                          <span className="text-white/30 text-[9px]">{lineCount} lines</span>
                          {truncated && <span className="text-yellow-500 text-[9px]">⚠ 32KB limit</span>}
                        </div>
                      </div>
                      <button onClick={() => setSelectedFile(null)} className="text-white/30 hover:text-white/50 text-sm px-1 transition-colors">✕</button>
                    </div>
                  </div>
                )
              })()}

              {/* NEW: Image URL preview */}
              {imageUrlPreview && (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0f0f0f] border border-white/10">
                  <img src={imageUrlPreview} alt="url preview" className="w-12 h-12 object-contain rounded" onError={() => setImageUrlPreview(null)} />
                  <span className="text-xs text-white/40 flex-1 truncate">{imageUrlPreview.slice(0, 50)}…</span>
                  <button onClick={() => { setImageUrlPreview(null); setImageUrlDraft('') }} className="text-white/30 hover:text-white text-xs ml-1">✕</button>
                </div>
              )}
              {/* Task 8: @-mention agent dropdown */}
              {showMentionDropdown && (() => {
                const filtered = AGENT_OPTIONS.filter(a =>
                  a.id.toLowerCase().includes(mentionFilter) || a.label.toLowerCase().includes(mentionFilter)
                )
                return filtered.length > 0 ? (
                  <div className="mb-2 rounded-xl border border-white/10 overflow-hidden shadow-xl" style={{background:'#0f0f0f'}}>
                    <p className="text-[9px] text-white/30 uppercase tracking-widest px-3 pt-2 pb-1">Route to agent</p>
                    {filtered.map((a, i) => (
                      <button
                        key={a.id}
                        onClick={() => {
                          setInputVal(v => v.replace(/@\w*$/, `@${a.id} `))
                          setSelectedAgent(a.id)
                          setShowMentionDropdown(false)
                          textareaRef.current?.focus()
                        }}
                        className={'w-full text-left px-3 py-2 flex items-center gap-2.5 border-b border-white/10/50 last:border-0 transition-colors ' +
                          (i === mentionIdx ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-[#0f0f0f]')}>
                        <span className="text-sm shrink-0">{a.label.split(' ')[0]}</span>
                        <span className="font-mono text-xs text-blue-400 shrink-0">@{a.id}</span>
                        <span className="text-[10px] text-white/30">{a.desc}</span>
                      </button>
                    ))}
                  </div>
                ) : null
              })()}
              {/* NEW: Slash command palette */}
              {showSlashPalette && slashFilter.length > 0 && (
                <div className="mb-2 rounded-xl border border-white/10 overflow-hidden shadow-xl" style={{background:'#0f0f0f'}}>
                  {slashFilter.map((c, i) => (
                    <button
                      key={c.cmd}
                      onClick={() => {
                        // For /imagine: insert command into input so user can type their prompt, don't execute
                        if (c.cmd === '/imagine') {
                          setInputVal('/imagine ')
                          setShowSlashPalette(false)
                          setTimeout(() => textareaRef.current?.focus(), 0)
                        } else {
                          executeSlashCommand(c.cmd)
                        }
                      }}
                      className={'w-full text-left px-3 py-2 flex items-center gap-2.5 border-b border-white/10/50 last:border-0 transition-colors ' +
                        (i === slashPaletteIdx ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-[#0f0f0f]')}>
                      <span className="text-base shrink-0">{c.icon}</span>
                      <span className="font-mono text-xs text-emerald-400 shrink-0">{c.cmd}</span>
                      <span className="text-[10px] text-white/30">{c.desc}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Feature 14: keyboard shortcut cheatsheet panel */}
              {showShortcuts && (
                <div className="mb-3 rounded-xl border border-white/10 bg-[#080808] p-3 no-print">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-white/50 uppercase tracking-widest font-semibold">Keyboard Shortcuts</p>
                    <button onClick={() => setShowShortcuts(false)} className="text-white/30 hover:text-white text-xs">✕</button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    {[
                      ['⌘K', 'New chat'],
                      ['↑/↓', 'Navigate conversations'],
                      ['Enter', 'Send message'],
                      ['⇧ Enter', 'New line'],
                      ['Esc', 'Cancel / close'],
                      ['⌘/', 'Focus input'],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center gap-2">
                        <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-[#0f0f0f] text-white/40 font-mono">{key}</kbd>
                        <span className="text-[10px] text-white/30">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* INF-70: Compact toolbar above input */}
              <div className="flex items-center gap-1 px-1 py-1.5 rounded-t-xl border border-b-0 border-white/10" style={{background:'#0c0c0c', paddingBottom: 'env(safe-area-inset-bottom, 0)'}}>
                {/* Paperclip button + file type picker */}
                <div className="relative shrink-0" ref={fileTypePickerRef}>
                  <button
                    onClick={() => setShowFileTypePicker(p => !p)}
                    disabled={isSending}
                    className="p-1.5 rounded-lg hover:bg-white/10 transition-all text-white/50 hover:text-white/70 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Attach file">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  </button>
                  {showFileTypePicker && (
                    <div className="absolute bottom-8 left-0 z-50 rounded-xl border border-white/10 overflow-hidden shadow-xl" style={{background:'#0f0f0f', minWidth:'160px'}}>
                      {FILE_TYPE_GROUPS.map(g => (
                        <button key={g.label}
                          onClick={() => handleFileAttach(g.accept)}
                          className="w-full text-left px-3 py-2 text-xs text-white/70 hover:bg-white/10 transition-colors border-b border-white/10/50 last:border-0">
                          {g.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* File browser */}
                <button
                  onClick={() => { setShowFileBrowser(true); setFileBrowserPath('') }}
                  disabled={isSending}
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-all text-white/50 hover:text-white/70 disabled:opacity-40 disabled:cursor-not-allowed text-xs"
                  title="Browse workspace files">
                  📁
                </button>

                {/* Image URL input */}
                <div className="relative shrink-0">
                  <button
                    onClick={() => setShowImageUrlInput(v => !v)}
                    disabled={isSending}
                    className="p-1.5 rounded-lg hover:bg-white/10 transition-all text-white/50 hover:text-white/70 disabled:opacity-40 disabled:cursor-not-allowed text-xs"
                    title="Add image by URL">
                    🔗
                  </button>
                  {showImageUrlInput && (
                    <div className="absolute bottom-8 left-0 z-50 rounded-xl border border-white/10 shadow-xl p-2" style={{background:'#0f0f0f', minWidth:'240px'}}>
                      <p className="text-[9px] text-white/30 mb-1.5 uppercase tracking-widest">Image URL</p>
                      <input
                        autoFocus
                        type="url"
                        value={imageUrlDraft}
                        onChange={e => setImageUrlDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && imageUrlDraft.trim()) {
                            setImageUrlPreview(imageUrlDraft.trim())
                            setShowImageUrlInput(false)
                          }
                          if (e.key === 'Escape') setShowImageUrlInput(false)
                        }}
                        placeholder="https://example.com/image.png"
                        className="w-full bg-[#0f0f0f] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white/70 placeholder-white/30 outline-none focus:border-white/20"
                      />
                      <p className="text-[9px] text-white/20 mt-1">Press Enter to add preview</p>
                    </div>
                  )}
                </div>

                {/* Slash commands */}
                <button
                  onClick={() => { setInputVal('/'); setShowSlashPalette(true); textareaRef.current?.focus() }}
                  disabled={isSending}
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-all text-white/50 hover:text-white/70 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-mono"
                  title="Slash commands">
                  /
                </button>

                <div className="flex-1" />

                {/* Agent selector */}
                <AgentSelector
                  value={selectedAgent}
                  disabled={isSending}
                  onChange={next => {
                    const prev = selectedAgent
                    setSelectedAgent(next)
                    // MC-37: Show handoff indicator in chat
                    if (activeConv && prev !== next && activeConv.messages.length > 0) {
                      const handoffMsg: ChatMessage = {
                        id: 'handoff-' + Date.now(),
                        role: 'assistant',
                        content: `**Agent handoff**: ${AGENT_OPTIONS.find(a=>a.id===prev)?.label || prev} → ${AGENT_OPTIONS.find(a=>a.id===next)?.label || next}`,
                        ts: Date.now(),
                        agent_id: '__handoff__',
                      }
                      setChats(cs => cs.map(c => c.id === activeConv.id ? { ...c, messages: [...c.messages, handoffMsg] } : c))
                    }
                  }}
                />

                {/* Model selector */}
                <select
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)}
                  disabled={isSending}
                  className="hidden sm:block px-1.5 py-1 rounded-lg bg-[#0f0f0f] border border-white/10 text-[10px] text-white/40 shrink-0 outline-none focus:border-white/20 disabled:opacity-50 cursor-pointer"
                  title="Select model">
                  {MODEL_PROVIDERS.map(provider => (
                    <optgroup key={provider} label={provider}>
                      {MODEL_OPTIONS.filter(m => m.provider === provider).map(m => (
                        <option key={m.id} value={m.id} title={m.desc}>
                          {m.label}{m.ctx ? ` (${m.ctx})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>

                {/* Send-to-agent button */}
                {showSendToAgent !== undefined && (
                  <button
                    onClick={() => setShowSendToAgent(v => !v)}
                    disabled={isSending}
                    className="p-1.5 rounded-lg hover:bg-white/10 transition-all text-white/50 hover:text-white/70 disabled:opacity-40 disabled:cursor-not-allowed text-xs"
                    title="Send to agent">
                    📤
                  </button>
                )}
              </div>
              {/* Input row — native messaging feel */}
              <div className="flex items-end gap-2" style={{paddingBottom: 'env(safe-area-inset-bottom, 0)'}}>
                {/* Auto-grow textarea */}
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputVal}
                  onChange={(e) => {
                    const val = e.target.value
                    setInputVal(val)
                    adjustTextarea()
                    if (val) setFollowUpSuggestions([])
                    // Slash command palette — hide once user has typed a space after the command (they have their prompt)
                    if (val.startsWith('/') && !val.includes(' ')) {
                      setShowSlashPalette(true)
                      setSlashPaletteIdx(0)
                    } else {
                      setShowSlashPalette(false)
                    }
                    // @-mention routing
                    const atMatch = val.match(/@(\w*)$/)
                    if (atMatch) {
                      setMentionFilter(atMatch[1].toLowerCase())
                      setShowMentionDropdown(true)
                      setMentionIdx(0)
                    } else {
                      setShowMentionDropdown(false)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (showMentionDropdown) {
                      const filtered = AGENT_OPTIONS.filter(a =>
                        a.id.toLowerCase().includes(mentionFilter) || a.label.toLowerCase().includes(mentionFilter)
                      )
                      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => Math.min(i+1, filtered.length-1)); return }
                      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => Math.max(i-1, 0)); return }
                      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                        e.preventDefault()
                        const chosen = filtered[mentionIdx]
                        if (chosen) {
                          setInputVal(v => v.replace(/@\w*$/, `@${chosen.id} `))
                          setSelectedAgent(chosen.id)
                          setShowMentionDropdown(false)
                        }
                        return
                      }
                      if (e.key === 'Escape') { setShowMentionDropdown(false); return }
                    }
                    if (showSlashPalette) {
                      const visible = slashFilter
                      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashPaletteIdx(i => Math.min(i+1, visible.length-1)); return }
                      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashPaletteIdx(i => Math.max(i-1, 0)); return }
                      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                        e.preventDefault()
                        const chosen = visible[slashPaletteIdx]
                        if (chosen) {
                          if (chosen.cmd === '/imagine') {
                            setInputVal('/imagine ')
                            setShowSlashPalette(false)
                            setTimeout(() => textareaRef.current?.focus(), 0)
                          } else {
                            executeSlashCommand(chosen.cmd)
                          }
                        }
                        return
                      }
                      if (e.key === 'Escape') { setShowSlashPalette(false); return }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    } else if (e.key === 'Enter' && e.shiftKey) {
                      setTimeout(adjustTextarea, 0)
                    }
                  }}
                  disabled={isSending}
                  placeholder={isListening ? 'Listening...' : isSending ? `${currentAgent.label} is writing…` : `Message ${currentAgent.label} (${agentModelLabel})...`}
                  className="flex-1 px-4 py-2 rounded-lg bg-[#0f0f0f] border border-white/10 text-white text-sm placeholder-white/30 outline-none focus:border-white/10 transition-all resize-none overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{minHeight:'38px', maxHeight:'160px'}}
                />

                {/* Feature 11: voice input button */}
                {speechAvailable && (
                  <button
                    onClick={toggleVoiceInput}
                    disabled={isSending}
                    title={isListening ? 'Stop listening' : 'Voice input'}
                    className={
                      'p-2 rounded-lg transition-all text-sm shrink-0 mb-0.5 disabled:opacity-40 disabled:cursor-not-allowed ' +
                      (isListening ? 'bg-red-600 text-white anim-mic' : 'hover:bg-[#0f0f0f] text-white/50 hover:text-white/70')
                    }>
                    🎤
                  </button>
                )}

                {/* Send / Stop button */}
                {loading ? (
                  <button
                    onClick={() => { abortControllerRef.current?.abort(); setLoading(false) }}
                    className="w-9 h-9 rounded-lg bg-red-900/40 border border-red-800/50 text-red-300 hover:bg-red-900/70 transition-colors flex items-center justify-center text-sm shrink-0 mb-0.5"
                    title="Stop generation">
                    ■
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!inputVal.trim() || isSending}
                    className="p-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-white shrink-0 mb-0.5">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9-7-9-7m0 0l-9 7m9-7v7" />
                    </svg>
                  </button>
                )}
              </div>

              <div className="hidden md:flex items-center justify-between mt-2 no-print">
                <p className="text-white/20 text-[10px]">
                  <kbd className="px-1.5 py-0.5 rounded bg-[#0f0f0f] text-white/50">Enter</kbd> send ·
                  <kbd className="px-1.5 py-0.5 rounded bg-[#0f0f0f] text-white/50 ml-1">⇧ Enter</kbd> newline ·
                  <kbd className="px-1.5 py-0.5 rounded bg-[#0f0f0f] text-white/50 ml-1">⌘K</kbd> new chat ·
                  <span className="ml-1 text-white/20">right-click conv to pin</span>
                </p>
                <div className="flex items-center gap-2">
                  {/* MC-162: Enhanced character/token counter with progress indicator */}
                  {(() => {
                    const charCount = inputVal.length
                    const tokenEstimate = Math.ceil(charCount / 4)
                    const charLimit = 10000
                    const tokenLimit = 2500
                    const pct = Math.min(100, Math.round((charCount / charLimit) * 100))
                    const color = charCount > charLimit ? '#ef4444' : charCount > charLimit * 0.7 ? '#eab308' : '#555'
                    return charCount > 0 ? (
                      <div className="flex items-center gap-1.5">
                        {/* MC-161: Mini progress arc */}
                        <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0">
                          <circle cx="8" cy="8" r="6" fill="none" stroke="#222" strokeWidth="2" />
                          <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="2"
                            strokeDasharray={`${pct * 0.377} 37.7`}
                            strokeLinecap="round"
                            transform="rotate(-90 8 8)" />
                        </svg>
                        <span className={`text-[9px] tabular-nums font-mono`} style={{ color }}>
                          {charCount.toLocaleString()} chars · ~{tokenEstimate.toLocaleString()} tok
                          {charCount > charLimit && ' ⚠'}
                        </span>
                      </div>
                    ) : null
                  })()}
                  {/* Task 7: Prompt templates popover */}
                  <div className="relative" ref={promptTemplatesRef}>
                    <button
                      onClick={() => setShowPromptTemplates(v => !v)}
                      className={'text-[10px] w-5 h-5 rounded flex items-center justify-center border transition-colors ' +
                        (showPromptTemplates ? 'border-white/20 text-yellow-400 bg-white/10' : 'border-white/10 text-white/30 hover:border-white/20 hover:text-white/40')}
                      title="Prompt templates">
                      💡
                    </button>
                    {showPromptTemplates && (
                      <div className="absolute bottom-7 right-0 z-50 w-64 rounded-xl border border-white/10 shadow-2xl overflow-hidden" style={{background:'#0f0f0f'}}>
                        <p className="text-[9px] text-white/30 uppercase tracking-widest px-3 pt-2.5 pb-1.5">Starter prompts</p>
                        {PROMPT_TEMPLATES.map((t, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              setInputVal(t.text)
                              setShowPromptTemplates(false)
                              setTimeout(() => { textareaRef.current?.focus(); adjustTextarea() }, 50)
                            }}
                            className="w-full text-left px-3 py-2 text-[11px] text-white/70 hover:bg-white/10 transition-colors border-b border-white/10/50 last:border-0">
                            {t.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Feature 14: keyboard cheatsheet button */}
                  <button
                    onClick={() => setShowShortcuts(v => !v)}
                    className={'text-[10px] w-5 h-5 rounded flex items-center justify-center border transition-colors ' +
                      (showShortcuts ? 'border-white/20 text-white/40 bg-white/10' : 'border-white/10 text-white/30 hover:border-white/20 hover:text-white/40')}>
                    ?
                  </button>
                </div>
              </div>
              {selectedFile && selectedFile.content.length > 32768 && (
                <p className="text-[10px] text-yellow-500 mt-1">
                  ⚠️ File is {(selectedFile.content.length / 1024).toFixed(0)}KB — only first 32KB will be sent to avoid context overflow.
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* NEW: File Browser Modal */}
      {showFileBrowser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowFileBrowser(false)}>
          <div className="w-96 max-h-[70vh] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden" style={{background:'#0f0f0f'}} onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span>📁</span>
                <span className="text-xs text-white/40 font-medium">Workspace Files</span>
                {fileBrowserPath && <span className="text-[9px] text-white/30 font-mono truncate max-w-[160px]">/{fileBrowserPath}</span>}
              </div>
              <div className="flex items-center gap-2">
                {fileBrowserPath && (
                  <button
                    onClick={() => setFileBrowserPath(p => p.split('/').slice(0,-1).join('/'))}
                    className="text-[10px] text-white/50 hover:text-white px-2 py-0.5 rounded border border-white/10 hover:border-white/20">
                    ← Up
                  </button>
                )}
                <button onClick={() => setShowFileBrowser(false)} className="text-white/30 hover:text-white text-xs">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {fileBrowserEntries.length === 0 ? (
                <p className="text-white/30 text-xs px-4 py-3">Empty directory</p>
              ) : (
                fileBrowserEntries.map(entry => (
                  <button
                    key={entry.path}
                    onClick={async () => {
                      if (entry.isDir) {
                        setFileBrowserPath(entry.path)
                      } else {
                        // Read file and attach
                        const res = await fetch('/api/files', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({path: entry.path}) })
                        const data = await res.json()
                        if (data.content !== undefined) {
                          setSelectedFile({ name: entry.name, content: data.content })
                          setShowFileBrowser(false)
                        }
                      }
                    }}
                    className="w-full text-left px-4 py-2 flex items-center gap-2 hover:bg-white/10/60 transition-colors">
                    <span className="text-sm shrink-0">{entry.isDir ? '📁' : '📄'}</span>
                    <span className="text-xs text-white/70 truncate">{entry.name}</span>
                    {!entry.isDir && <span className="text-[9px] text-white/30 ml-auto shrink-0">.{entry.name.split('.').pop()}</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
