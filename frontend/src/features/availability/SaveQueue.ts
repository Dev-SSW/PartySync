export interface QueueState {
  paused: boolean
  pending: boolean
  saving: boolean
  error: unknown
  saved: boolean
}

/** 800ms 입력 묶음, 직렬 PUT, 저장 상태 비교, 묶음당 한 번의 조회 갱신을 담당합니다. */
export class SaveQueue<T> {
  private items = new Map<string, T>()
  private confirmed = new Map<string, T>()
  private lastSaved = new Map<string, string>()
  private timer?: ReturnType<typeof setTimeout>
  private running?: Promise<void>
  private runningKey?: string
  private dueAt = 0
  private forced = false
  private needsRefresh = false
  private listeners = new Set<() => void>()
  private state: QueueState = {
    paused: false,
    pending: false,
    saving: false,
    error: null,
    saved: false,
  }
  constructor(
    private send: (key: string, value: T) => Promise<void>,
    private acknowledged: (key: string, value: T) => void,
    private delay = 800,
    private refresh: () => Promise<void> = async () => {},
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = () => this.state
  private fingerprint(value: T) {
    return JSON.stringify(value)
  }
  seed(key: string, value: T) {
    if (!this.items.has(key) && !this.confirmed.has(key) && this.runningKey !== key)
      this.lastSaved.set(key, this.fingerprint(value))
  }
  private emit(patch: Partial<QueueState>) {
    this.state = { ...this.state, ...patch }
    this.state.pending = !!(this.items.size || this.confirmed.size || this.state.paused)
    this.listeners.forEach((fn) => fn())
  }
  private schedule() {
    clearTimeout(this.timer)
    if (!this.state.error && !this.running && !this.state.paused && this.state.pending)
      this.timer = setTimeout(
        () => {
          void this.flush(false)
        },
        Math.max(0, this.dueAt - Date.now()),
      )
  }
  enqueue(key: string, value: T) {
    this.dueAt = Date.now() + this.delay
    this.items.set(key, value)
    // 전송 중인 값과 혼동하지 않고, DB와 같은 선택으로 돌아온 경우만 생략합니다.
    if (
      this.runningKey !== key &&
      !this.confirmed.has(key) &&
      this.lastSaved.get(key) === this.fingerprint(value)
    ) {
      this.items.delete(key)
      this.acknowledged(key, value)
    }
    this.emit({
      saved: !this.items.size && !this.confirmed.size,
      ...(!this.items.size && !this.confirmed.size ? { error: null } : {}),
    })
    this.schedule()
  }
  pause() {
    clearTimeout(this.timer)
    this.emit({ paused: true })
  }
  resume() {
    this.dueAt = Date.now() + this.delay
    this.emit({ paused: false })
    this.schedule()
  }
  async flush(force = true): Promise<boolean> {
    clearTimeout(this.timer)
    if (this.state.paused) return false
    this.forced ||= force
    if (this.running) {
      await this.running
      return this.state.pending && !this.state.error && force
        ? this.flush(true)
        : !this.state.pending && !this.state.error
    }
    this.emit({ error: null })
    this.running = this.drain()
    await this.running
    this.running = undefined
    this.forced = false
    this.schedule()
    return !this.state.pending && !this.state.error
  }
  private async drain() {
    try {
      while (this.items.size && !this.state.paused && (this.forced || Date.now() >= this.dueAt)) {
        const [key, value] = this.items.entries().next().value!
        const stamp = this.fingerprint(value)
        this.runningKey = key
        this.emit({ saving: true })
        if (this.lastSaved.get(key) !== stamp) {
          await this.send(key, value)
          // PUT 성공과 GET 실패를 구분해 기록하여 재시도 때 같은 PUT을 반복하지 않습니다.
          this.lastSaved.set(key, stamp)
          this.needsRefresh = true
        }
        const latest = this.items.get(key)!
        if (this.fingerprint(latest) === stamp) {
          this.items.delete(key)
          this.confirmed.set(key, latest)
        } else this.confirmed.set(key, value)
        this.runningKey = undefined
      }
      if (this.items.size || this.state.paused) {
        this.emit({ saving: false })
        return
      }
      if (this.needsRefresh) {
        this.emit({ saving: true })
        await this.refresh()
        this.needsRefresh = false
      }
      for (const [key, value] of this.confirmed) {
        if (!this.items.has(key)) this.acknowledged(key, value)
        this.confirmed.delete(key)
      }
      this.emit({ saving: false, saved: !this.items.size })
    } catch (error) {
      this.runningKey = undefined
      this.emit({ error, saving: false })
    }
  }
}
