export function percentile(values, quantile) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] : null
}
// Serialized into the browser before navigation; independent of runner load waits.
export function installCanvasReadinessProbe() {
  window.canvasPerfReadyMs = null
  const check = () => {
    const canvas = document.querySelector('.j-canvas'), status = document.querySelector('.j-layout-status [role="status"]')
    const tool = document.querySelector('.j-canvas-controls button[aria-pressed]')
    if (canvas && status?.textContent === '已保存' && tool && !tool.disabled) {
      window.canvasPerfReadyMs = performance.now(); observer.disconnect()
    }
  }
  const observer = new MutationObserver(check)
  observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled'] })
  check()
  return () => observer.disconnect()
}
export function summarizeSamples(values) {
  const valid = values.filter(Number.isFinite)
  return { samples: valid.length, median: percentile(valid, .5), worst: valid.length ? Math.max(...valid) : null }
}
export function parsePerformanceOptions(args) {
  const options = { counts: [100, 500, 2000], runs: 5, profiles: ['desktop', 'tablet'], themes: ['light', 'dark'], stressMs: 600000, pathMs: 400 }
  for (const arg of args) {
    if (arg === '--baseline') continue
    const [key, value] = arg.split('=')
    if (key === '--counts') options.counts = value?.split(',').map(Number)
    else if (key === '--runs') options.runs = Number(value)
    else if (key === '--profiles') options.profiles = value?.split(',')
    else if (key === '--themes') options.themes = value?.split(',')
    else if (key === '--stress-ms') options.stressMs = Number(value)
    else if (key === '--path-ms') options.pathMs = Number(value)
    else throw new Error(`Unsupported performance option: ${arg}; --compare requires the future cache implementation`)
  }
  if (!options.counts?.length || !options.counts.every(n => Number.isInteger(n) && n >= 8 && n <= 2000) || new Set(options.counts).size !== options.counts.length) throw new Error('Invalid counts')
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 10) throw new Error('Invalid runs')
  if (!options.profiles?.length || !options.profiles.every(p => ['desktop', 'tablet'].includes(p)) || new Set(options.profiles).size !== options.profiles.length) throw new Error('Invalid profiles')
  if (!options.themes?.length || !options.themes.every(t => ['light', 'dark'].includes(t)) || new Set(options.themes).size !== options.themes.length) throw new Error('Invalid themes')
  if (!Number.isInteger(options.stressMs) || options.stressMs < 0 || options.stressMs > 600000 || !Number.isInteger(options.pathMs) || options.pathMs < 100 || options.pathMs > 2000) throw new Error('Invalid measurement duration')
  return options
}
export function performanceCases(options) {
  return options.counts.flatMap(count => options.profiles.flatMap(profile => options.themes.flatMap(theme => Array.from({ length: options.runs }, (_, run) => ({ count, profile, theme, run: run + 1 })))))
}
export function summarizeCases(cases) {
  const groups = new Map()
  for (const sample of cases) {
    const key = `${sample.count}/${sample.profile}/${sample.theme}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(sample)
  }
  return [...groups].map(([key, values]) => ({ key, runs: values.length,
    editableMs: summarizeSamples(values.map(v => v.editableMs)),
    overviewImages: summarizeSamples(values.map(v => v.phases.find(p => p.name === 'overview')?.dom.images)),
    panFrameP95Ms: summarizeSamples(values.map(v => percentile(v.phases.filter(p => p.name.startsWith('pan')).flatMap(p => p.frames), .95))),
    visible95Ms: summarizeSamples(values.map(v => v.visible95Ms)),
    mediaRequests: summarizeSamples(values.map(v => (v.shortNetwork || v.network).requests)),
    repeatedMediaRequests: summarizeSamples(values.map(v => { const n = v.shortNetwork || v.network; return n.requests - n.uniqueUrls })),
    maxJsHeapBytes: summarizeSamples(values.map(v => { const samples = v.phases.filter(p => p.name !== 'stress').map(p => p.metrics.JSHeapUsedSize).filter(Number.isFinite); return samples.length ? Math.max(...samples) : null })),
    maxBrowserWorkingSetBytes: summarizeSamples(values.map(v => { const samples = v.memory.filter(m => !m.phase.startsWith('stress')).map(m => m.workingSetBytes); return samples.length ? Math.max(...samples) : null })),
  }))
}
