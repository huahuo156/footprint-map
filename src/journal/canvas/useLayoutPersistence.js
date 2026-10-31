import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createLayoutPersistence } from './persistence.js'

const EMPTY = Object.freeze({ status: 'loading', items: Object.freeze([]), error: null, conflict: false, canUndo: false, canRedo: false, canRetry: false, hasUnconfirmed: false })

/** Supply a unique account/mount sessionKey. Transport is captured per session;
 * changing its callback identity must never discard the current draft.
 * Baselines are explicit: ordinary re-renders must never replace a draft.
 * Structural actions must honor signal/guard and return a fresh layout baseline.
 */
export function useLayoutPersistence({ sessionKey, send }) {
  const identity = useMemo(() => ({}), [sessionKey])
  const sendRef = useRef(send)
  sendRef.current = send
  const scopeRef = useRef(null)
  const [view, setView] = useState(null)
  useLayoutEffect(() => {
    const scope = { identity, active: true, controller: null, unsubscribe: null, abort: new AbortController(), barrierStatus: 'idle', barrierError: null }
    scopeRef.current = scope
    scope.publish = () => {
      if (!scope.active || scopeRef.current !== scope) return
      setView({ identity, snapshot: scope.controller?.getSnapshot() || EMPTY, barrierStatus: scope.barrierStatus, barrierError: scope.barrierError })
    }
    scope.send = sendRef.current
    scope.publish()
    return () => {
      scope.active = false
      scope.abort.abort()
      scope.unsubscribe?.()
      scope.controller?.dispose()
      if (scopeRef.current === scope) scopeRef.current = null
    }
  }, [identity])

  const actions = useMemo(() => {
    function current() {
      const scope = scopeRef.current
      if (!scope?.active || scope.identity !== identity) throw new DOMException('账号或页面已切换，请重新操作。', 'AbortError')
      return scope
    }
    function controller() {
      const scope = current()
      if (scope.barrierStatus !== 'idle') throw new Error('请先完成操作并重新载入布局')
      if (!scope.controller) throw new Error('布局尚未载入')
      return scope.controller
    }
    function captureSession() {
      const scope = current()
      return { signal: scope.abort.signal, guard() {
        if (current() !== scope || scope.abort.signal.aborted) throw new DOMException('账号或页面已切换，请重新操作。', 'AbortError')
      } }
    }
    function replaceBaseline(baseline) {
      const scope = current()
      if (scope.barrierStatus === 'running') throw new Error('操作进行中，请稍后重新载入')
      if (scope.controller) scope.controller.replaceBaseline(baseline)
      else {
        scope.controller = createLayoutPersistence({ baseline, send: scope.send })
        scope.unsubscribe = scope.controller.subscribe(scope.publish)
      }
      scope.barrierStatus = 'idle'; scope.barrierError = null; scope.publish()
    }
    async function runOperation(action, discardConflict = false) {
      if (typeof action !== 'function') throw new TypeError('Missing structural operation')
      const scope = current(), engine = scope.controller
      if (scope.barrierStatus === 'running' || !engine) throw new Error('布局尚未就绪或操作进行中')
      const state = engine.getSnapshot()
      if (!(state.status === 'saved' && !state.hasUnconfirmed) && !(discardConflict && state.conflict)) throw new Error('请先保存当前布局或处理保存冲突，再继续操作')
      if (scope.barrierStatus === 'reload-required' && !discardConflict) throw new Error('请先重新载入布局')
      scope.barrierStatus = 'running'; scope.barrierError = null; scope.publish()
      const { guard, signal } = captureSession()
      try {
        guard()
        const baseline = await action({ signal, guard })
        guard()
        engine.replaceBaseline(baseline)
        scope.barrierStatus = 'idle'; scope.publish()
        return baseline
      } catch (error) {
        if (scope.active && scopeRef.current === scope) {
          scope.barrierStatus = 'reload-required'
          scope.barrierError = error instanceof Error ? error.message : '操作失败，请重新载入布局'
          scope.publish()
        }
        throw error
      }
    }
    return { captureSession, replaceBaseline, getSnapshot: () => { const scope = current(); return { ...(scope.controller?.getSnapshot() || EMPTY), barrierStatus: scope.barrierStatus } }, runStructureOperation: action => runOperation(action), reloadBaseline: (action, { discardConflict = false } = {}) => runOperation(action, discardConflict || current().barrierStatus === 'reload-required'), editLayout: command => controller().editLayout(command), undoLayout: () => controller().undoLayout(), redoLayout: () => controller().redoLayout(), retryLayout: () => controller().retryLayout() }
  }, [identity])
  const visible = view?.identity === identity ? view : { snapshot: EMPTY, barrierStatus: 'idle', barrierError: null }
  const blocked = visible.barrierStatus !== 'idle'
  return { ...visible.snapshot, barrierStatus: visible.barrierStatus, barrierError: visible.barrierError, canUndo: !blocked && visible.snapshot.canUndo, canRedo: !blocked && visible.snapshot.canRedo, canRetry: !blocked && visible.snapshot.canRetry, ...actions }
}
