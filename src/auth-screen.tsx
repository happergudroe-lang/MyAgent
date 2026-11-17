import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Sparkles } from 'lucide-react'
import './auth-screen.css'

type AuthUser = { id: string; email: string; username: string }
type AuthScreenProps = {
  theme: 'light' | 'dark'
  onAuthenticated: (user: AuthUser) => void
}
type Step = 'email' | 'password' | 'create' | 'success'

const stepOrder: Record<Step, number> = { email: 0, password: 1, create: 1, success: 2 }
const transitionVariants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 24 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction * -24 }),
}

export default function AuthScreen({ theme, onAuthenticated }: AuthScreenProps) {
  const [step, setStep] = useState<Step>('email')
  const [direction, setDirection] = useState(1)
  const [email, setEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [authenticatedUser, setAuthenticatedUser] = useState<AuthUser | null>(null)

  const passwordStrength = useMemo(() => {
    const checks = [password.length >= 10, /[a-z]/.test(password) && /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)]
    return checks.filter(Boolean).length
  }, [password])

  const moveTo = (next: Step) => {
    setDirection(stepOrder[next] >= stepOrder[step] ? 1 : -1)
    setError('')
    setStep(next)
  }

  useEffect(() => {
    if (!authenticatedUser) return
    const timer = window.setTimeout(() => onAuthenticated(authenticatedUser), 680)
    return () => window.clearTimeout(timer)
  }, [authenticatedUser, onAuthenticated])

  async function readResponse(response: Response) {
    const raw = await response.text()
    let data: any
    try { data = JSON.parse(raw) } catch { throw new Error('服务器暂时无法处理请求，请稍后重试。') }
    if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试。')
    return data
  }

  async function checkEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
      setError('请输入有效的邮箱地址。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized }),
      })
      const data = await readResponse(response)
      setEmail(normalized)
      moveTo(data.exists ? 'password' : 'create')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法验证邮箱，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  async function authenticate(event: React.FormEvent<HTMLFormElement>, mode: 'login' | 'register') {
    event.preventDefault()
    setBusy(true)
    setError('')
    if (mode === 'register') {
      if (nickname.trim().length < 2 || nickname.trim().length > 32) {
        setError('昵称需要为 2–32 个字符。')
        setBusy(false)
        return
      }
      if (password.length < 10 || password.length > 128) {
        setError('密码长度需要为 10–128 位。')
        setBusy(false)
        return
      }
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致。')
        setBusy(false)
        return
      }
    }
    try {
      const response = await fetch(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'login'
          ? { email, password }
          : { email, username: nickname.trim(), password }),
      })
      const data = await readResponse(response)
      if (!data.user) throw new Error('服务器响应缺少用户信息。')
      setAuthenticatedUser(data.user as AuthUser)
      setStep('success')
      setDirection(1)
    } catch (cause) {
      setError(mode === 'login'
        ? '邮箱或密码不正确'
        : cause instanceof Error ? cause.message : '创建账号失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  const isPasswordStep = step === 'password'
  const isCreateStep = step === 'create'

  return (
    <main className="auth-flow-screen" data-theme={theme}>
      <section className="auth-flow-layout">
        <aside className="auth-flow-aside">
          <div className="auth-flow-brand">
            <span className="auth-flow-brand-mark"><Sparkles size={19} /></span>
            <span>MyAgent</span>
          </div>
          <div className="auth-flow-aside-copy">
            <span className="auth-flow-eyebrow">YOUR AI WORKSPACE</span>
            <h1>让每个想法，<br />都有继续前进的空间。</h1>
            <p>一个专注、可靠的 AI 工作空间，帮助你把问题、灵感与项目稳步推进。</p>
          </div>
          <div className="auth-flow-aside-foot"><ShieldCheck size={15} /> 安全登录 · 私人工作空间</div>
        </aside>

        <section className="auth-flow-main">
          <div className="auth-flow-mobile-brand">
            <span className="auth-flow-brand-mark"><Sparkles size={18} /></span>
            <b>MyAgent</b>
          </div>
          <div className="auth-flow-card">
            <div className="auth-flow-progress" aria-label="登录步骤">
              <span className={stepOrder[step] >= 0 ? 'is-active' : ''} />
              <span className={stepOrder[step] >= 1 ? 'is-active' : ''} />
              <span className={step === 'success' ? 'is-active' : ''} />
            </div>

            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={step}
                className="auth-flow-step"
                custom={direction}
                variants={transitionVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.24, ease: [0.22, 0.68, 0, 1] }}
              >
                {step === 'email' && (
                  <>
                    <div className="auth-flow-step-icon"><Mail size={19} /></div>
                    <span className="auth-flow-kicker">WELCOME TO MYAGENT</span>
                    <h2>开始使用</h2>
                    <p className="auth-flow-description">输入你的邮箱，我们将为你打开对应的账户入口。</p>
                    <form onSubmit={checkEmail}>
                      <label className="auth-flow-label" htmlFor="auth-email">邮箱地址</label>
                      <input id="auth-email" className="auth-flow-input" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" autoFocus required />
                      {error && <p className="auth-flow-error" role="alert">{error}</p>}
                      <button className="auth-flow-submit" type="submit" disabled={busy}>
                        {busy ? '正在验证…' : '继续'} <ArrowRight size={16} />
                      </button>
                    </form>
                    <p className="auth-flow-legal">继续即表示你同意以安全方式使用 MyAgent。</p>
                  </>
                )}

                {isPasswordStep && (
                  <>
                    <button className="auth-flow-back" type="button" onClick={() => moveTo('email')}><ArrowLeft size={15} /> 返回</button>
                    <div className="auth-flow-step-icon"><LockKeyhole size={19} /></div>
                    <span className="auth-flow-kicker">WELCOME BACK</span>
                    <h2>欢迎回来</h2>
                    <p className="auth-flow-description">输入密码，继续你的工作空间。</p>
                    <div className="auth-flow-email-pill"><Mail size={14} /><span>{email}</span></div>
                    <form onSubmit={event => authenticate(event, 'login')}>
                      <label className="auth-flow-label" htmlFor="auth-login-password">密码</label>
                      <div className="auth-flow-password-wrap">
                        <input id="auth-login-password" className="auth-flow-input" type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="输入你的密码" autoComplete="current-password" autoFocus required />
                        <button className="auth-flow-reveal" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                      </div>
                      {error && <p className="auth-flow-error" role="alert">{error}</p>}
                      <button className="auth-flow-submit" type="submit" disabled={busy}>
                        {busy ? '正在登录…' : '登录 MyAgent'} <ArrowRight size={16} />
                      </button>
                    </form>
                    <p className="auth-flow-legal">你的工作空间仅对你的账号开放。</p>
                  </>
                )}

                {isCreateStep && (
                  <>
                    <button className="auth-flow-back" type="button" onClick={() => moveTo('email')}><ArrowLeft size={15} /> 返回</button>
                    <div className="auth-flow-step-icon"><Sparkles size={19} /></div>
                    <span className="auth-flow-kicker">CREATE YOUR ACCOUNT</span>
                    <h2>创建账号</h2>
                    <p className="auth-flow-description">设置昵称与密码，开启你的个人 AI 工作空间。</p>
                    <div className="auth-flow-email-pill"><Mail size={14} /><span>{email}</span></div>
                    <form onSubmit={event => authenticate(event, 'register')}>
                      <label className="auth-flow-label" htmlFor="auth-nickname">昵称</label>
                      <input id="auth-nickname" className="auth-flow-input" type="text" value={nickname} onChange={event => setNickname(event.target.value)} placeholder="你的昵称" minLength={2} maxLength={32} autoComplete="nickname" required />
                      <label className="auth-flow-label auth-flow-label-spaced" htmlFor="auth-create-password">设置密码</label>
                      <div className="auth-flow-password-wrap">
                        <input id="auth-create-password" className="auth-flow-input" type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="至少 10 位字符" minLength={10} maxLength={128} autoComplete="new-password" required />
                        <button className="auth-flow-reveal" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                      </div>
                      <div className="auth-flow-strength" aria-label={'密码强度 ' + passwordStrength + ' / 4'}>
                        <div className="auth-flow-strength-bars">{[0, 1, 2, 3].map(index => <span key={index} className={passwordStrength > index ? 'filled' : ''} />)}</div>
                        <small>{password.length === 0 ? '密码至少需要 10 位' : passwordStrength <= 1 ? '较弱' : passwordStrength <= 2 ? '一般' : passwordStrength === 3 ? '较强' : '强'}</small>
                      </div>
                      <label className="auth-flow-label auth-flow-label-spaced" htmlFor="auth-confirm-password">确认密码</label>
                      <input id="auth-confirm-password" className="auth-flow-input" type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="再次输入密码" autoComplete="new-password" required />
                      {error && <p className="auth-flow-error" role="alert">{error}</p>}
                      <button className="auth-flow-submit" type="submit" disabled={busy}>
                        {busy ? '正在创建…' : '创建账号'} <ArrowRight size={16} />
                      </button>
                    </form>
                    <p className="auth-flow-legal">密码经过安全哈希处理，不会以明文保存。</p>
                  </>
                )}

                {step === 'success' && (
                  <div className="auth-flow-success">
                    <div className="auth-flow-success-icon"><Check size={28} strokeWidth={2.4} /></div>
                    <span className="auth-flow-kicker">ALL SET</span>
                    <h2>准备就绪</h2>
                    <p className="auth-flow-description">身份验证成功，正在打开你的工作空间…</p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
            <div className="auth-flow-card-foot"><ShieldCheck size={14} /> 账号信息通过加密连接安全传输</div>
          </div>
          <footer className="auth-flow-footer">© {new Date().getFullYear()} MyAgent</footer>
        </section>
      </section>
    </main>
  )
}
