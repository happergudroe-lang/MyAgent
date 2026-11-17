import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import './auth-screen.css'

type AuthUser = { id: string; email: string; username: string }
type AuthScreenProps = {
  theme: 'light' | 'dark'
  onAuthenticated: (user: AuthUser) => void
}
type Step = 'email' | 'password' | 'create-password' | 'nickname' | 'success'

const progressFor: Record<Step, number> = {
  email: 0,
  password: 1,
  'create-password': 1,
  nickname: 2,
  success: 3,
}
const spring = { type: 'spring' as const, stiffness: 340, damping: 17, mass: 0.85 }
const stepVariants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 46, scale: 0.97, rotate: direction * 0.6 }),
  center: { opacity: 1, x: 0, scale: 1, rotate: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction * -46, scale: 0.97, rotate: direction * -0.6 }),
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
    const checks = [password.length >= 10, /[a-z]/.test(password) && /[A-Z]/.test(password), /\\d/.test(password), /[^A-Za-z0-9]/.test(password)]
    return checks.filter(Boolean).length
  }, [password])

  const moveTo = (next: Step) => {
    setDirection(progressFor[next] >= progressFor[step] ? 1 : -1)
    setError('')
    setStep(next)
  }

  useEffect(() => {
    if (!authenticatedUser) return
    const timer = window.setTimeout(() => onAuthenticated(authenticatedUser), 1100)
    return () => window.clearTimeout(timer)
  }, [authenticatedUser, onAuthenticated])

  async function readResponse(response: Response) {
    const raw = await response.text()
    let data: any
    try { data = JSON.parse(raw) } catch { throw new Error('服务器暂时无法处理请求，请稍后重试。') }
    if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试。')
    return data
  }

  async function checkEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = email.trim().toLowerCase()
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalized) || normalized.length > 254) {
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
      moveTo(data.exists ? 'password' : 'create-password')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法验证邮箱，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  async function authenticate(event: FormEvent<HTMLFormElement>, mode: 'login' | 'register') {
    event.preventDefault()
    setBusy(true)
    setError('')
    if (password.length < 10 || password.length > 128) {
      setError('密码长度需要为 10–128 位。')
      setBusy(false)
      return
    }
    if (mode === 'register') {
      if (nickname.trim().length < 2 || nickname.trim().length > 32) {
        setError('昵称需要为 2–32 个字符。')
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
      setDirection(1)
      setStep('success')
    } catch (cause) {
      setError(mode === 'login'
        ? '邮箱或密码不正确'
        : cause instanceof Error ? cause.message : '创建账号失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  const back = () => {
    if (step === 'password' || step === 'create-password') moveTo('email')
    else if (step === 'nickname') moveTo('create-password')
  }
  const currentTitle = step === 'email' ? '你的空间，从这里开始。' :
    step === 'password' ? '欢迎回来。' :
    step === 'create-password' ? '为你的空间设置密码。' :
    step === 'nickname' ? '最后一步，认识一下你。' : '欢迎，' + (authenticatedUser?.username || nickname || '回来')

  return (
    <main className="auth-immersive" data-theme={theme}>
      <div className="auth-ambient" aria-hidden="true"><i /><i /><i /><span /></div>
      <motion.section className="auth-immersive-card" initial={{ opacity: 0, y: 24, scale: 0.975 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}>
        <aside className="auth-immersive-brand-panel">
          <div className="auth-brand-lockup">
            <span className="auth-brand-symbol"><Sparkles size={19} strokeWidth={2.2} /></span>
            <span>MyAgent</span>
          </div>
          <div className="auth-brand-grid" aria-hidden="true" />
          <div className="auth-brand-orb auth-brand-orb-one" aria-hidden="true" />
          <div className="auth-brand-orb auth-brand-orb-two" aria-hidden="true" />
          <div className="auth-brand-copy">
            <span className="auth-brand-eyebrow">A SPACE FOR WHAT'S NEXT</span>
            <h1>让每个想法，<br />都有继续前进的空间。</h1>
            <p>把灵感变成行动，把复杂变得清晰。<br />一个为持续创造而生的 AI 工作空间。</p>
            <div className="auth-brand-pills"><span><Sparkles size={12} /> 灵感与创造</span><span><ShieldCheck size={12} /> 私密且安全</span></div>
          </div>
          <div className="auth-brand-watermark" aria-hidden="true">✳</div>
          <div className="auth-brand-foot"><span className="auth-brand-status" /> YOUR PERSONAL AI WORKSPACE</div>
        </aside>

        <section className="auth-immersive-main">
          <div className="auth-main-glow" aria-hidden="true" />
          <button className="auth-round-back" type="button" onClick={back} disabled={step === 'email' || step === 'success'} aria-label="返回上一步" title="返回上一步"><ArrowLeft size={18} /></button>
          <div className="auth-progress" aria-label="注册进度">
            {[0, 1, 2, 3].map(index => <span key={index} className={progressFor[step] >= index ? 'is-active' : ''} />)}
          </div>
          <div className="auth-form-content">
            <div className="auth-form-heading">
              <span className="auth-form-eyebrow">{step === 'success' ? 'YOU ARE ALL SET' : 'WELCOME TO MYAGENT'}</span>
              <h2>{currentTitle}</h2>
              <p>{step === 'email' ? '输入邮箱，继续你的旅程。' :
                step === 'password' ? '输入账户密码，即可回到你的工作空间。' :
                step === 'create-password' ? '创建一个安全密码，保护你的个人空间。' :
                step === 'nickname' ? '设置一个昵称，让我们知道如何称呼你。' :
                '身份验证成功，正在为你打开工作空间。'}</p>
            </div>

            <AnimatePresence mode="wait" custom={direction}>
              <motion.div key={step} className="auth-step" custom={direction} variants={stepVariants}
                initial="enter" animate="center" exit="exit" transition={spring}>
                {step === 'email' && <form onSubmit={checkEmail}>
                  <label className="auth-field">
                    <span className="auth-field-icon"><Mail size={18} /></span>
                    <span className="auth-field-copy"><small>EMAIL ADDRESS</small><input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" autoFocus required /></span>
                  </label>
                  {error && <p className="auth-error" role="alert">{error}</p>}
                  <button className="auth-next" type="submit" disabled={busy} aria-label="继续">{busy ? <span className="auth-spinner" /> : <ArrowRight size={21} />}</button>
                </form>}

                {step === 'password' && <form onSubmit={event => authenticate(event, 'login')}>
                  <div className="auth-account-pill"><Mail size={14} /><span>{email}</span></div>
                  <label className="auth-field">
                    <span className="auth-field-icon"><LockKeyhole size={18} /></span>
                    <span className="auth-field-copy"><small>PASSWORD</small><input type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="输入你的密码" autoComplete="current-password" autoFocus required /></span>
                    <button className="auth-reveal" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                  </label>
                  {error && <p className="auth-error" role="alert">{error}</p>}
                  <button className="auth-next" type="submit" disabled={busy} aria-label="登录">{busy ? <span className="auth-spinner" /> : <ArrowRight size={21} />}</button>
                </form>}

                {step === 'create-password' && <form onSubmit={event => { event.preventDefault(); setError(''); if (password.length < 10 || password.length > 128) { setError('密码长度需要为 10–128 位。'); return } if (password !== confirmPassword) { setError('两次输入的密码不一致。'); return } moveTo('nickname') }}>
                  <div className="auth-account-pill"><Mail size={14} /><span>{email}</span></div>
                  <label className="auth-field">
                    <span className="auth-field-icon"><LockKeyhole size={18} /></span>
                    <span className="auth-field-copy"><small>CREATE PASSWORD</small><input type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="至少 10 位字符" autoComplete="new-password" autoFocus required /></span>
                    <button className="auth-reveal" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                  </label>
                  <div className="auth-strength"><div>{[0, 1, 2, 3].map(index => <i key={index} className={passwordStrength > index ? 'filled' : ''} />)}</div><small>{password.length === 0 ? '至少 10 位字符' : passwordStrength <= 1 ? '较弱' : passwordStrength <= 2 ? '一般' : passwordStrength === 3 ? '较强' : '强'}</small></div>
                  <label className="auth-field auth-field-secondary">
                    <span className="auth-field-icon"><LockKeyhole size={18} /></span>
                    <span className="auth-field-copy"><small>CONFIRM PASSWORD</small><input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="再次输入密码" autoComplete="new-password" required /></span>
                  </label>
                  {error && <p className="auth-error" role="alert">{error}</p>}
                  <button className="auth-next" type="submit" disabled={busy} aria-label="下一步">{busy ? <span className="auth-spinner" /> : <ArrowRight size={21} />}</button>
                </form>}

                {step === 'nickname' && <form onSubmit={event => authenticate(event, 'register')}>
                  <div className="auth-account-pill"><Mail size={14} /><span>{email}</span></div>
                  <label className="auth-field">
                    <span className="auth-field-icon"><UserRound size={18} /></span>
                    <span className="auth-field-copy"><small>YOUR NAME</small><input type="text" value={nickname} onChange={event => setNickname(event.target.value)} placeholder="你的昵称" minLength={2} maxLength={32} autoComplete="nickname" autoFocus required /></span>
                  </label>
                  {error && <p className="auth-error" role="alert">{error}</p>}
                  <button className="auth-next" type="submit" disabled={busy} aria-label="创建账号">{busy ? <span className="auth-spinner" /> : <ArrowRight size={21} />}</button>
                </form>}

                {step === 'success' && <div className="auth-success">
                  <motion.div className="auth-success-check" initial={{ scale: 0.6, rotate: -18 }} animate={{ scale: 1, rotate: 0 }} transition={spring}><Check size={31} strokeWidth={2.8} /></motion.div>
                  <strong>欢迎，{authenticatedUser?.username || nickname || '回来'}</strong>
                  <span>正在进入你的专属工作空间…</span>
                </div>}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="auth-main-foot"><ShieldCheck size={14} /> 安全连接 · 你的空间只属于你</div>
        </section>
      </motion.section>
      <div className="auth-copyright">© {new Date().getFullYear()} MYAGENT · MADE FOR WHAT'S NEXT</div>
    </main>
  )
}
