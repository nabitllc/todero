import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { prompt } = await req.json()
  if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 })

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY
  if (!OPENROUTER_KEY) return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 })

  // Use Gemini 2.5 Flash Image via OpenRouter — cheapest (~$0.04/image), chat completions format
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kaos.nabit.work',
      'X-Title': 'KAOS Mission Control',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-image',
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image', 'text'],
    }),
  })

  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    const text = await res.text()
    return NextResponse.json({ error: `Unexpected response (${res.status}): ${text.slice(0, 200)}` }, { status: 500 })
  }

  const data = await res.json()
  if (!res.ok) {
    return NextResponse.json({ error: data?.error?.message || JSON.stringify(data?.error) || 'OpenRouter error' }, { status: res.status })
  }

  // OpenRouter returns images in message.images array
  const msg = data?.choices?.[0]?.message
  const images = msg?.images
  if (Array.isArray(images) && images.length > 0) {
    const url = images[0]?.image_url?.url
    if (url) return NextResponse.json({ url, provider: 'openrouter/gemini-2.5-flash-image' })
  }
  // Fallback: check content parts
  const content = msg?.content
  if (Array.isArray(content)) {
    const imgPart = content.find((p: any) => p.type === 'image_url')
    if (imgPart?.image_url?.url) return NextResponse.json({ url: imgPart.image_url.url, provider: 'openrouter/gemini-2.5-flash-image' })
  }
  if (typeof content === 'string' && content.startsWith('data:image')) {
    return NextResponse.json({ url: content, provider: 'openrouter/gemini-2.5-flash-image' })
  }

  // Fallback: try openai/dall-e-3 if configured
  const OPENAI_KEY = process.env.OPENAI_API_KEY
  if (OPENAI_KEY) {
    const r2 = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', response_format: 'url' }),
    })
    const d2 = await r2.json()
    const url = d2?.data?.[0]?.url
    if (url) return NextResponse.json({ url, provider: 'openai/dall-e-3' })
  }

  return NextResponse.json({ error: 'No image returned. Response: ' + JSON.stringify(data).slice(0, 300) }, { status: 500 })
}
