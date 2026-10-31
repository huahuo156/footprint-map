import { Fragment, createContext, useContext, useEffect, useRef, useState } from 'react'
import { authRequest, clearApiSession, fetchSession, setApiSession } from '../lib/api'
import Modal from '../journal/Modal'
import { ArrowUpRight, BadgeCheck, LockKeyhole, LogOut, Mail, ShieldCheck } from 'lucide-react'
import '../journal/journal.css'
import './account.css'
const AccountContext = createContext(null)
export const useAccount = () => useContext(AccountContext)
function authLink() { const params = new URLSearchParams(window.location.hash.slice(1)); return { mode: params.get('auth'), token: params.get('token') } }
export function AccountGate({ children }) {
  const [session, setSession] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [link, setLink] = useState(authLink)
  const version = useRef(0)
  function accept(next) { version.current += 1; setApiSession(next); setSession(next?.user ? next : null) }
  useEffect(() => {
    let alive = true
    const expected = version.current
    fetchSession().then(next => { if (alive && expected === version.current) accept(next) }).catch(error => { if (alive && error.name !== 'AbortError') setError(error.message) }).finally(() => { if (alive) setLoading(false) })
    const expire = () => { version.current += 1; clearApiSession(); setSession(null); setLoading(false) }
    const hash = () => setLink(authLink())
    window.addEventListener('shitu-session-expired', expire); window.addEventListener('hashchange', hash)
    return () => { alive = false; clearApiSession(); window.removeEventListener('shitu-session-expired', expire); window.removeEventListener('hashchange', hash) }
  }, [])
  function clearLink() { history.replaceState(null, '', location.pathname + location.search); setLink({}) }
  async function completed(mode) {
    if (mode === 'reset') accept(null)
    else {
      try { accept(await fetchSession()) }
      catch (error) { if (error.status === 401) accept(null); else throw error }
    }
    clearLink()
  }
  async function logout() {
    const token = session?.csrfToken
    version.current += 1; clearApiSession(); setSession(null)
    try { await authRequest('logout', {}, { headers: { 'X-CSRF-Token': token || '' } }) }
    catch (error) { if (error.name !== 'AbortError') setError('本机内容已关闭。退出请求未完成，请重试登录后退出。') }
  }
  const context = { user: session?.user, accept, logout }
  if (loading) return <div className="journal-loading" role="status">正在打开拾途…</div>
  // Accepting a session invalidates every captured API guard, even for the same
  // user. Remount private content with it so hooks never retain an old guard.
  return <AccountContext.Provider value={context}>{link.mode === 'verify' || link.mode === 'reset' ? <AuthScreen initialMode={link.mode} token={link.token} onAccepted={accept} onDone={clearLink} onCompleted={completed} /> : session ? <Fragment key={version.current}>{children(session.user)}</Fragment> : <AuthScreen initialError={error} onAccepted={accept} />}</AccountContext.Provider>
}
function AuthScreen({ initialMode = 'login', token, initialError = '', onAccepted, onDone, onCompleted }) {
  const [mode, setMode] = useState(initialMode), [error, setError] = useState(initialError), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const titles = { login:'登录', register:'注册', forgot:'找回密码', reset:'设置新密码', verify:'验证邮箱' }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    const fields = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const action = { forgot:'forgot-password', reset:'reset-password', verify:'verify-email' }[mode] || mode
      const result = await authRequest(action, { ...fields, ...(token ? { token } : {}) })
      if (result.user && result.csrfToken) { onAccepted(result); onDone?.() }
      else if (mode === 'register') { setMessage('注册成功，请到邮箱查看验证邮件，然后登录。'); setMode('login') }
      else if (mode === 'forgot') setMessage('如果该邮箱已注册，重置密码的邮件会发送到邮箱。')
      else if (mode === 'reset' || mode === 'verify') { setMessage(mode === 'verify' ? '邮箱已验证，请登录。' : '密码已更新，请重新登录。'); setMode('login'); await onCompleted?.(mode) }
      else setError('未能建立会话，请重试登录。')
    } catch (error) { if (error.name !== 'AbortError') setError(error.message) }
    finally { setBusy(false) }
  }
  function change(next) { setMode(next); setError(''); setMessage('') }
  return <main className="journal-app j-account-screen"><section className="j-account-card"><span className="j-account-brand">拾途 · 私人旅行手帐</span><h1>{titles[mode]}</h1><p>把走过的地方，留在自己的手帐里。</p><form onSubmit={submit}>
    {['login','register','forgot'].includes(mode) && <label>邮箱<input type="email" name="email" autoComplete="email" required maxLength={254} /></label>}
    {['login','register','reset'].includes(mode) && <label>{mode === 'reset' ? '新密码' : '密码'}<input type="password" name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 12} required maxLength={128} /></label>}
    {mode === 'verify' && <p>点击下方按钮验证邮箱。</p>}
    {error && <p className="j-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}<button className="j-button j-primary" disabled={busy}>{busy ? '正在处理…' : titles[mode]}</button>
  </form><nav aria-label="账号选项">{mode !== 'login' && <button className="j-button" onClick={() => { change('login'); onDone?.() }}>返回登录</button>}{mode === 'login' && <><button className="j-button" onClick={() => change('register')}>注册账号</button><button className="j-button" onClick={() => change('forgot')}>忘记密码</button></>}</nav></section></main>
}
export function AccountMenu({ onClose }) {
  const account = useAccount()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  async function action(name, fields = {}) {
    setBusy(true); setError(''); setMessage('')
    try { await authRequest(name, fields); if (name === 'change-password') await account.logout(); else setMessage('验证邮件已发送，请检查邮箱。') }
    catch (error) { if (error.name !== 'AbortError') setError(error.message) } finally { setBusy(false) }
  }
  return <Modal title="我的账号" onClose={onClose} busy={busy} className="j-account-modal">
    <p className="j-account-intro">管理登录信息，安心收藏每一段旅途。</p>
    <section className="j-account-profile" aria-label="账号信息">
      <span className="j-account-avatar" aria-hidden="true">{account?.user?.email?.charAt(0).toUpperCase() || '拾'}</span>
      <div className="j-account-identity"><span className="j-account-caption">登录邮箱</span><p>{account?.user?.email}</p><span className={'j-account-badge' + (account?.user?.email_verified ? ' is-verified' : '')}>{account?.user?.email_verified ? <BadgeCheck aria-hidden="true" /> : <Mail aria-hidden="true" />}{account?.user?.email_verified ? '邮箱已验证' : '邮箱待验证'}</span></div>
    </section>
    {!account?.user?.email_verified && <div className="j-account-verification"><p>验证邮箱后，即可上传照片和还原备份。</p><button className="j-button" disabled={busy} onClick={() => action('resend-verification')}>重发验证邮件<ArrowUpRight aria-hidden="true" /></button></div>}
    <form className="j-account-form" onSubmit={event => { event.preventDefault(); action('change-password', Object.fromEntries(new FormData(event.currentTarget))) }}>
      <div className="j-account-section-heading"><LockKeyhole aria-hidden="true" /><h3>修改密码</h3><span>账号安全</span></div>
      <label>当前密码<input type="password" name="currentPassword" required autoComplete="current-password" placeholder="输入当前使用的密码" disabled={busy} /></label>
      <label>新密码<input type="password" name="password" minLength={12} maxLength={128} required autoComplete="new-password" placeholder="设置新的登录密码" aria-describedby="account-password-hint" disabled={busy} /></label>
      <p id="account-password-hint" className="j-account-hint">使用 12–128 位字符，建议组合字母、数字与符号。</p>
      <button className="j-button j-primary j-account-save" disabled={busy}>{busy ? '正在处理…' : '更新密码'}<ArrowUpRight aria-hidden="true" /></button>
      <p className="j-account-relogin"><ShieldCheck aria-hidden="true" />更新后需重新登录，以保护你的账号。</p>
    </form>
    {error && <p role="alert" className="j-error">{error}</p>}{message && <p role="status" className="j-account-message">{message}</p>}
    <footer className="j-account-footer"><span>拾途 · 私人旅行手帐</span><button className="j-button j-account-logout" disabled={busy} onClick={() => account.logout()}><LogOut aria-hidden="true" />退出登录</button></footer>
  </Modal>
}
