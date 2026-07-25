export interface JobMetric {
  model: string
  totalDurationNs: number
  loadDurationNs: number
  promptEvalCount: number
  promptEvalDurationNs: number
  evalCount: number
  evalDurationNs: number
  doneReason: string
}

export interface Job {
  id: string
  status: string
  /** Present once AMC has a completed result to show — merged in by `getJob()` from a
   *  separate log entry, since AMC's job record has no output field of its own. */
  output?: string
  /** Present for agent-based jobs — AMC returns the submitting agent's display name. */
  agentName?: string
  /** Present once AMC has recorded timing data for the call (merged from `/metrics`). */
  metrics?: JobMetric
}

export interface JobGroup {
  id: string
  status: string
  jobs: Job[]
}

export interface RunnerStatus {
  online: boolean
  queuedJobs: number
  runningJobs: number
}
