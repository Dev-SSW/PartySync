import { SaveQueue } from '../features/availability/SaveQueue'

describe('자동 저장 직렬 큐', () => {
  it('서버 상태로 되돌린 선택은 PUT과 갱신 GET 모두 생략한다', async () => {
    vi.useFakeTimers()
    const send = vi.fn(),
      refresh = vi.fn(),
      ack = vi.fn()
    const queue = new SaveQueue(send, ack, 800, refresh)
    queue.seed('date', [false, false])
    queue.enqueue('date', [true, true])
    queue.enqueue('date', [false, false])
    await vi.advanceTimersByTimeAsync(800)
    expect(send).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(queue.getSnapshot().pending).toBe(false)
  })
  it('PUT 성공 뒤 GET만 실패하면 재시도에서는 PUT을 반복하지 않는다', async () => {
    const send = vi.fn().mockResolvedValue(undefined),
      ack = vi.fn()
    const refresh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const queue = new SaveQueue(send, ack, 800, refresh)
    queue.enqueue('weekly', [true])
    expect(await queue.flush()).toBe(false)
    expect(ack).not.toHaveBeenCalled()
    expect(queue.getSnapshot().pending).toBe(true)
    expect(await queue.flush()).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(ack).toHaveBeenCalledWith('weekly', [true])
  })
  it('저장 중 추가 입력에도 마지막 입력 후 800ms를 기다리고 조회는 한 번만 갱신한다', async () => {
    vi.useFakeTimers()
    let complete!: () => void
    const send = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          complete = resolve
        }),
      )
      .mockResolvedValue(undefined)
    const refresh = vi.fn().mockResolvedValue(undefined),
      queue = new SaveQueue(send, vi.fn(), 800, refresh)
    queue.enqueue('date', [true, false])
    await vi.advanceTimersByTimeAsync(800)
    queue.enqueue('date', [true, true])
    complete()
    await vi.advanceTimersByTimeAsync(799)
    expect(send).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(1)
    queue.enqueue('date', [true, true])
    await vi.advanceTimersByTimeAsync(800)
    expect(send).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('요청 중 이전 DB 상태로 돌아가도 진행 중 PUT 다음에 복원 요청을 보낸다', async () => {
    let complete!: () => void
    const send = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          complete = resolve
        }),
      )
      .mockResolvedValue(undefined)
    const queue = new SaveQueue(send, vi.fn())
    queue.seed('date', [false])
    queue.enqueue('date', [true])
    const writing = queue.flush()
    queue.enqueue('date', [false])
    complete()
    expect(await writing).toBe(true)
    expect(send.mock.calls.map((call) => call[1])).toEqual([[true], [false]])
  })
  it('오래 드래그해도 요청하지 않고 놓은 후 변경 전체를 저장한다', async () => {
    vi.useFakeTimers()
    const send = vi.fn().mockResolvedValue(undefined),
      queue = new SaveQueue(send, vi.fn())
    queue.pause()
    queue.enqueue('date', [true, false])
    await vi.advanceTimersByTimeAsync(1000)
    queue.enqueue('date', [true, true])
    await vi.advanceTimersByTimeAsync(1000)
    expect(send).not.toHaveBeenCalled()
    expect(await queue.flush()).toBe(false)
    queue.resume()
    await vi.advanceTimersByTimeAsync(800)
    expect(send).toHaveBeenCalledExactlyOnceWith('date', [true, true])
  })
  afterEach(() => vi.useRealTimers())
  it('800ms 안의 빠른 클릭은 최신 하루 전체 스냅샷으로 합친다', async () => {
    vi.useFakeTimers()
    const send = vi.fn().mockResolvedValue(undefined)
    const queue = new SaveQueue(send, vi.fn())
    queue.enqueue('monday', [true, false])
    queue.enqueue('monday', [true, true])
    queue.enqueue('monday', [false, true])
    await vi.advanceTimersByTimeAsync(799)
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledExactlyOnceWith('monday', [false, true])
    expect(queue.getSnapshot().pending).toBe(false)
  })
  it('진행 중인 PUT을 기다리고 새 초안을 다음 요청으로 전송한다', async () => {
    let complete!: () => void
    const first = new Promise<void>((resolve) => {
      complete = resolve
    })
    const send = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined),
      ack = vi.fn()
    const queue = new SaveQueue(send, ack)
    const old = [true, false],
      latest = [true, true]
    queue.enqueue('weekly', old)
    const flushing = queue.flush()
    queue.enqueue('weekly', latest)
    queue.enqueue('tuesday', [true])
    expect(send).toHaveBeenCalledTimes(1)
    complete()
    expect(await flushing).toBe(true)
    expect(send.mock.calls.map((call) => call[0])).toEqual(['weekly', 'weekly', 'tuesday'])
    expect(send.mock.calls[1][1]).toBe(latest)
    expect(ack).not.toHaveBeenCalledWith('weekly', old)
  })
  it('실패 후 최신 선택을 보존하고 재시도 시 최신 스냅샷을 보낸다', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const queue = new SaveQueue(send, vi.fn())
    queue.enqueue('date', [true])
    expect(await queue.flush()).toBe(false)
    expect(queue.getSnapshot()).toMatchObject({ pending: true, saved: false })
    queue.enqueue('date', [false])
    expect(await queue.flush()).toBe(true)
    expect(send.mock.calls[1][1]).toEqual([false])
    expect(queue.getSnapshot()).toMatchObject({ pending: false, error: null, saved: true })
  })
  it('날짜별 요청을 모두 저장한 뒤에만 화면 이동 가능 상태가 된다', async () => {
    const send = vi.fn().mockResolvedValue(undefined),
      queue = new SaveQueue(send, vi.fn())
    queue.enqueue('monday', [])
    queue.enqueue('sunday', [true])
    expect(queue.getSnapshot().pending).toBe(true)
    expect(await queue.flush()).toBe(true)
    expect(send).toHaveBeenCalledTimes(2)
  })
})
