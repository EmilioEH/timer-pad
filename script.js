;(() => {
  const CHECKPOINT = 300
  const STORE = {
    HASH: 'tp_hash',
    LIMIT: 'tp_limit',
    DATE: 'tp_date',
    ACC: 'tp_acc',
    RUNNING: 'tp_run',
    START: 'tp_start',
    BLOCK: 'tp_block',
  }

  let state = {
    accumulated: 0,
    running: false,
    startTime: null,
    lastBlock: -1,
    limit: 15,
    todayDate: '',
  }

  let tickId = null

  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id)

  const screens = {
    idle: $('screen-idle'),
    running: $('screen-running'),
  }

  const modals = {
    takeover: $('modal-takeover'),
    blocked: $('modal-blocked'),
    settings: $('modal-settings'),
    setup: $('modal-setup'),
  }

  // ---- Utilities ----
  function fmt(sec) {
    sec = Math.max(0, Math.round(sec))
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  function today() {
    return new Date().toISOString().slice(0, 10)
  }

  // ---- Password ----
  async function hashPw(pw) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw))
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  function getStoredHash() {
    return localStorage.getItem(STORE.HASH) || ''
  }

  async function verifyPw(pw) {
    if (!pw) return false
    return (await hashPw(pw)) === getStoredHash()
  }

  async function setPw(pw) {
    localStorage.setItem(STORE.HASH, await hashPw(pw))
  }

  function hasPw() {
    return !!localStorage.getItem(STORE.HASH)
  }

  // ---- Storage ----
  function save() {
    localStorage.setItem(STORE.ACC, String(Math.round(state.accumulated)))
    localStorage.setItem(STORE.DATE, state.todayDate)
    localStorage.setItem(STORE.LIMIT, String(state.limit))
    localStorage.setItem(STORE.RUNNING, state.running ? '1' : '0')
    localStorage.setItem(STORE.BLOCK, String(state.lastBlock))
    if (state.startTime) {
      localStorage.setItem(STORE.START, String(state.startTime))
    } else {
      localStorage.removeItem(STORE.START)
    }
  }

  function load() {
    const d = today()
    state.todayDate = localStorage.getItem(STORE.DATE) || d
    state.limit = parseInt(localStorage.getItem(STORE.LIMIT)) || 15
    state.accumulated = parseInt(localStorage.getItem(STORE.ACC)) || 0
    state.lastBlock = parseInt(localStorage.getItem(STORE.BLOCK)) || -1
    state.running = localStorage.getItem(STORE.RUNNING) === '1'

    if (state.todayDate !== d) {
      state.accumulated = 0
      state.lastBlock = -1
      state.todayDate = d
      state.running = false
      localStorage.removeItem(STORE.START)
      save()
      return
    }

    if (state.running) {
      const start = parseInt(localStorage.getItem(STORE.START))
      if (start) {
        const elapsed = Math.floor((Date.now() - start) / 1000)
        if (elapsed > 0) {
          state.accumulated += elapsed
        }
        state.startTime = Date.now()
        save()
      } else {
        state.running = false
      }
    }

    if (state.running && state.accumulated >= state.limit * 60) {
      state.running = false
      state.startTime = null
      localStorage.removeItem(STORE.START)
      save()
    }
  }

  // ---- Screen ----
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'))
    screens[name].classList.add('active')
  }

  // ---- UI updates ----
  function updateIdle() {
    $('idleLimit').textContent = `${state.limit} minutes per day`
    $('idleToday').textContent = `${fmt(state.accumulated)} used today`
  }

  function updateRunning() {
    const elapsed = state.accumulated
    const remaining = state.limit * 60 - elapsed
    const pct = state.limit > 0 ? Math.min(100, (elapsed / (state.limit * 60)) * 100) : 0
    const block = Math.floor(elapsed / CHECKPOINT)
    const totalBlocks = Math.ceil((state.limit * 60) / CHECKPOINT)

    $('runningElapsed').textContent = fmt(elapsed)
    $('runningRemaining').textContent = `${fmt(Math.max(0, remaining))} remaining`

    const fill = $('progressFill')
    fill.style.width = `${pct}%`
    fill.className = 'progress-fill' + (pct >= 90 ? ' danger' : pct >= 70 ? ' warning' : '')

    $('blockInfo').textContent = `Checkpoint ${block} of ${Math.max(1, totalBlocks)}`
  }

  function updateTakeover() {
    $('takeoverElapsed').textContent = fmt(state.accumulated)
    $('takeoverRemaining').textContent = fmt(Math.max(0, state.limit * 60 - state.accumulated))
  }

  function updateBlocked() {
    $('blockedElapsed').textContent = fmt(state.accumulated)
    $('blockedLimit').textContent = fmt(state.limit * 60)
  }

  // ---- Modal ----
  function showModal(name) {
    Object.values(modals).forEach((m) => m.classList.remove('active'))
    modals[name].classList.add('active')
    // Focus the password input in the opened modal
    const pwInput = modals[name].querySelector('.password-input')
    if (pwInput) setTimeout(() => pwInput.focus(), 100)
  }

  function hideModals() {
    Object.values(modals).forEach((m) => m.classList.remove('active'))
  }

  function clearErrors() {
    document.querySelectorAll('.error-msg').forEach((e) => (e.textContent = ''))
  }

  // ---- Check conditions ----
  function checkModals() {
    if (state.accumulated >= state.limit * 60) {
      updateBlocked()
      showModal('blocked')
      pauseTimer()
      playAlarm()
      sendNotification()
      showScreen('running')
      updateRunning()
      return true
    }
    const block = Math.floor(state.accumulated / CHECKPOINT)
    if (block > state.lastBlock && block >= 1) {
      updateTakeover()
      showModal('takeover')
      pauseTimer()
      playAlarm()
      sendNotification()
      showScreen('running')
      updateRunning()
      return true
    }
    return false
  }

  // ---- Timer ----
  function startTimer() {
    if (state.running) return
    if (state.accumulated >= state.limit * 60) {
      showModal('blocked')
      return
    }
    state.running = true
    state.startTime = Date.now()
    save()
    hideModals()
    showScreen('running')
    updateRunning()
    startTicking()
  }

  function stopTimer() {
    state.running = false
    state.startTime = null
    localStorage.removeItem(STORE.START)
    save()
    stopTicking()
    showScreen('idle')
    updateIdle()
  }

  function tick() {
    if (!state.running) return
    const now = Date.now()
    const elapsed = Math.floor((now - state.startTime) / 1000)
    if (elapsed < 1) return
    state.accumulated += elapsed
    state.startTime = now

    updateRunning()
    checkModals()
    save()
  }

  function startTicking() {
    stopTicking()
    tickId = setInterval(tick, 1000)
  }

  function stopTicking() {
    if (tickId) {
      clearInterval(tickId)
      tickId = null
    }
  }

  function pauseTimer() {
    if (state.startTime) {
      const elapsed = Math.floor((Date.now() - state.startTime) / 1000)
      if (elapsed > 0) {
        state.accumulated += elapsed
      }
    }
    state.running = false
    state.startTime = null
    localStorage.removeItem(STORE.START)
    save()
    stopTicking()
  }

  function resumeTimer() {
    state.running = true
    state.startTime = Date.now()
    save()
    startTicking()
    updateRunning()
  }

  // ---- Notification & Alarm ----
  function playAlarm() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const play = (freq, start, dur) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.3, start)
        gain.gain.exponentialRampToValueAtTime(0.01, start + dur)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(start)
        osc.stop(start + dur)
      }
      const t = ctx.currentTime
      play(880, t, 0.15)
      play(880, t + 0.2, 0.15)
      play(880, t + 0.4, 0.15)
    } catch (_) { /* audio not available */ }
  }

  function sendNotification() {
    if ('Notification' in window && Notification.permission === 'granted') {
      const remaining = state.limit * 60 - state.accumulated
      try {
        new Notification('Timer Pad - Time Check', {
          body: `Used: ${fmt(state.accumulated)}  ·  Remaining: ${fmt(Math.max(0, remaining))}`,
          icon: '/icon.svg',
        })
      } catch (_) { /* notification failed */ }
    } else if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }

  // ---- Visibility ----
  function onVisible() {
    if (state.running) {
      const start = parseInt(localStorage.getItem(STORE.START))
      if (start) {
        const gap = Math.floor((Date.now() - start) / 1000)
        if (gap > 0) {
          state.accumulated += gap
          state.startTime = Date.now()
          save()
          updateRunning()
          if (checkModals()) return
        }
      }
      if (checkModals()) return
      startTicking()
      return
    }

    if (checkModals()) return
    showScreen('idle')
    updateIdle()
  }

  function onHidden() {
    if (state.running) {
      // Sync accumulated before going to background
      const elapsed = Math.floor((Date.now() - state.startTime) / 1000)
      if (elapsed > 0) {
        state.accumulated += elapsed
        state.startTime = Date.now()
        save()
      }
    }
    stopTicking()
  }

  // ---- Event handlers ----
  async function handleTakeoverConfirm() {
    const pw = $('takeoverPw').value
    $('takeoverError').textContent = ''
    if (!(await verifyPw(pw))) {
      $('takeoverError').textContent = 'Incorrect password'
      $('takeoverPw').value = ''
      $('takeoverPw').focus()
      return
    }
    state.lastBlock = Math.floor(state.accumulated / CHECKPOINT)
    $('takeoverPw').value = ''
    hideModals()
    if (state.accumulated >= state.limit * 60) {
      showModal('blocked')
      return
    }
    resumeTimer()
  }

  async function handleBlockedReset() {
    const pw = $('blockedPw').value
    $('blockedError').textContent = ''
    if (!(await verifyPw(pw))) {
      $('blockedError').textContent = 'Incorrect password'
      $('blockedPw').value = ''
      $('blockedPw').focus()
      return
    }
    state.accumulated = 0
    state.lastBlock = -1
    state.running = false
    state.startTime = null
    localStorage.removeItem(STORE.START)
    $('blockedPw').value = ''
    hideModals()
    save()
    showScreen('idle')
    updateIdle()
  }

  // Settings
  $('settingsBtn').addEventListener('click', () => { clearErrors(); showModal('settings') })
  $('settingsBtnRunning').addEventListener('click', () => { clearErrors(); showModal('settings') })

  $('settingsClose').addEventListener('click', () => {
    hideModals()
    clearErrors()
    $('settingsCurPw').value = ''
    $('settingsNewPw').value = ''
    $('settingsNewPw2').value = ''
  })

  $('settingsSaveLimit').addEventListener('click', async () => {
    const pw = $('settingsCurPw').value
    $('settingsError').textContent = ''
    if (!(await verifyPw(pw))) {
      $('settingsError').textContent = 'Incorrect password'
      return
    }
    const val = parseInt($('settingsLimit').value)
    if (isNaN(val) || val < 1) {
      $('settingsError').textContent = 'Enter a valid number'
      return
    }
    state.limit = val
    save()
    $('settingsError').textContent = 'Limit saved'
    $('settingsError').style.color = 'var(--success)'
    setTimeout(() => {
      $('settingsError').textContent = ''
      $('settingsError').style.color = ''
    }, 2000)
    updateIdle()
    updateRunning()
    if (state.accumulated >= state.limit * 60) {
      showModal('blocked')
    }
  })

  $('settingsChangePw').addEventListener('click', async () => {
    const cur = $('settingsCurPw').value
    const n1 = $('settingsNewPw').value
    const n2 = $('settingsNewPw2').value
    $('settingsError').textContent = ''
    if (!(await verifyPw(cur))) {
      $('settingsError').textContent = 'Current password is incorrect'
      return
    }
    if (!n1 || n1.length < 1) {
      $('settingsError').textContent = 'Enter a new password'
      return
    }
    if (n1 !== n2) {
      $('settingsError').textContent = 'Passwords do not match'
      return
    }
    await setPw(n1)
    $('settingsCurPw').value = ''
    $('settingsNewPw').value = ''
    $('settingsNewPw2').value = ''
    $('settingsError').textContent = 'Password changed'
    $('settingsError').style.color = 'var(--success)'
    setTimeout(() => {
      $('settingsError').textContent = ''
      $('settingsError').style.color = ''
    }, 2000)
  })

  $('settingsResetToday').addEventListener('click', async () => {
    const pw = $('settingsCurPw').value
    $('settingsError').textContent = ''
    if (!(await verifyPw(pw))) {
      $('settingsError').textContent = 'Incorrect password'
      return
    }
    state.accumulated = 0
    state.lastBlock = -1
    state.running = false
    state.startTime = null
    localStorage.removeItem(STORE.START)
    save()
    hideModals()
    showScreen('idle')
    updateIdle()
    clearErrors()
    $('settingsCurPw').value = ''
  })

  // Setup
  $('setupDone').addEventListener('click', async () => {
    const limit = parseInt($('setupLimit').value)
    const pw1 = $('setupPw').value
    const pw2 = $('setupPw2').value
    $('setupError').textContent = ''
    if (!limit || limit < 1) {
      $('setupError').textContent = 'Enter a valid time limit'
      return
    }
    if (!pw1 || pw1.length < 1) {
      $('setupError').textContent = 'Create a parent password'
      return
    }
    if (pw1 !== pw2) {
      $('setupError').textContent = 'Passwords do not match'
      return
    }
    state.limit = limit
    await setPw(pw1)
    save()
    hideModals()
    showScreen('idle')
    updateIdle()
  })

  // Start / Stop
  $('startBtn').addEventListener('click', startTimer)
  $('stopBtn').addEventListener('click', stopTimer)

  // Takeover
  $('takeoverConfirm').addEventListener('click', handleTakeoverConfirm)
  $('takeoverPw').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleTakeoverConfirm()
  })

  // Blocked
  $('blockedReset').addEventListener('click', handleBlockedReset)
  $('blockedPw').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleBlockedReset()
  })

  // Visibility
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      onHidden()
    } else {
      onVisible()
    }
  })

  window.addEventListener('pagehide', onHidden)
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) onVisible()
  })

  // ---- Init ----
  async function init() {
    load()

    if (!hasPw()) {
      showModal('setup')
      return
    }

    if (state.running) {
      startTicking()
      showScreen('running')
      updateRunning()
      if (checkModals()) return
    }

    if (checkModals()) return

    showScreen('idle')
    updateIdle()
  }

  init()
})()
