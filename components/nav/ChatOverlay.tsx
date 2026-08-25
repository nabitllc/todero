'use client'
// components/nav/ChatOverlay.tsx — TOD-2381 (nav-six-destinations)
// Chat is an overlay, not a destination: ⌘J opens it over whatever is on
// screen without navigating away; Escape (or the backdrop) closes it and the
// underlying screen is unchanged (app/page.tsx never touches destination/view
// state to open or close this).
//
// Honest gap (see builder report): "carries that screen as context" is only
// partially true. ChatTab's own props (components/tabs/ChatTab.tsx, owned by
// another Wave 6 piece) accept `selectedBusiness` and nothing else — there is
// no prop for "the destination/view/issue the operator was just looking at".
// This overlay passes selectedBusiness through, which is real, but it cannot
// inject the current destination as conversation context without editing
// ChatTab's internals, which is out of this piece's ownership.

import React, { useEffect } from 'react'
import { X } from 'lucide-react'
import ChatTab from '@/components/tabs/ChatTab'

interface Props {
  open: boolean
  onClose: () => void
  selectedBusiness: string | null
}

export default function ChatOverlay({ open, onClose, selectedBusiness }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[200] flex" role="dialog" aria-modal="true" aria-label="Chat">
      <button aria-label="Close chat" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative ml-auto h-full w-full sm:w-[560px] bg-neutral-950 border-l border-white/10 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 h-12 border-b border-white/10 shrink-0">
          <span className="text-white text-sm font-semibold">Chat</span>
          <button onClick={onClose} aria-label="Close (Esc)" className="text-white/70 hover:text-white p-1 rounded hover:bg-white/10">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <ChatTab selectedBusiness={selectedBusiness} />
        </div>
      </div>
    </div>
  )
}
