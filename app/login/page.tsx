import LoginForm from './LoginForm'

interface Props {
  searchParams?: { from?: string; error?: string }
}

export default function Login({ searchParams }: Props) {
  const from = searchParams?.from ?? '/'
  const error = searchParams?.error === '1'
  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#080808]">
      <div className="w-full max-w-[360px] px-6">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-[28px] mx-auto mb-4">
            🧠
          </div>
          <h1 className="text-white text-xl font-semibold">KAOS</h1>
          <p className="text-white/40 text-sm mt-1">Todero</p>
        </div>
        <LoginForm from={from} error={error} />
      </div>
    </div>
  )
}
