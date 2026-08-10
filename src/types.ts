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

/** The canonical runner state (AMC ADR 0016). It is the only field that
 *  distinguishes a machine resting between jobs (`asleep`, wakes on demand)
 *  from one that has actually fallen over (`unreachable`). */
export type RunnerState =
  | 'unknown'
  | 'asleep'
  | 'waking'
  | 'starting'
  | 'idle'
  | 'busy'
  | 'unreachable'

export interface RunnerModelState {
  name: string
  state: 'loaded' | 'loading'
  observedAt: string | null
  sizeVramBytes: number | null
  expiresAt: string | null
  lastLoadDurationMs: number | null
}

export interface RunnerFleetMember {
  runnerId: string
  state: RunnerState
  /** False for an always-on machine, which therefore can never be `asleep` or
   *  `waking` — for those, silence always means a fault. */
  wakeable: boolean
  warmModel: string | null
  gpuName: string | null
  vramMb: number | null
  lastHeartbeatAt: string | null
}

export interface RunnerStatus {
  online: boolean
  state: RunnerState
  queuedJobs: number
  runningJobs: number
  gpuName: string | null
  vramMb: number | null
  defaultModel: string | null
  models: RunnerModelState[]
  /** Per-runner detail. The scalar fields above are a rollup over this. */
  runners: RunnerFleetMember[]
}

// Job/JobGroup/JobMetric/RunnerStatus above are a curated, hand-picked shape
// (getJob() merges in fields AMC's job record doesn't natively have). Everything
// below this line mirrors its REST endpoint's response 1:1 instead — no merging,
// no curation — so don't "fix" the difference in style.

export interface Project {
  id: string
  userId: string
  name: string
  description: string | null
  websiteUrl: string | null
  promptPrefix: string
  promptSuffix: string
  dailyJobLimit: number | null
  publicStatus: 'none' | 'pending' | 'approved'
  publicUrl: string | null
  publicRequestedAt: string | null
  publicApprovedAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  agentCount: number
  jobCount: number
  tokenCount: number
  latestActivityAt: string | null
}

export interface Agent {
  id: string
  projectId: string
  name: string
  model: string
  systemPrompt: string
  promptSuffix: string
  assistantPrefill: string
  avatar: string | null
  tools: string[]
  managedBy: 'user' | 'admin' | 'sysadmin'
  triggeredBy: 'human_only' | 'any_agent' | 'human_initiated_chain'
  minimumChainRole: 'user' | 'admin' | 'sysadmin'
  publishApproval: 'auto' | 'requires_human_confirmation'
  delegateToAgents: boolean
  createdById: string
  createdAt: string
  deletedAt: string | null
  skills: string[]
  knowledgeBases: string[]
  turnLimit: number
}

export interface Batch {
  id: string
  projectId: string
  name: string | null
  repeatN: number
  totalJobs: number
  completedJobs: number
  status: 'pending' | 'running' | 'complete' | 'partial' | 'failed'
  userId: string
  createdAt: string
}

export interface BatchSubmitInput {
  name?: string
  promptIds: string[]
  preambleIds?: string[]
  suffixIds?: string[]
  prefillIds?: string[]
  modelIds: string[]
  repeatN?: number
  agentId: string
  controlPreamble?: boolean
  controlSuffix?: boolean
  controlPrefill?: boolean
}

export interface BatchGroupJob {
  id: string
  groupId: string
  agentId: string | null
  agentName: string | null
  agentSystemPrompt: string | null
  agentPromptSuffix: string | null
  effectiveModel: string | null
  status: string
  type: string
  position: number
  createdAt: string
  completedAt: string | null
  response: string | null
}

export interface BatchGroup {
  id: string
  projectId: string
  groupNumber: number
  name: string | null
  prompt: string
  isPublic: boolean
  userId: string
  originatingRole: string
  createdAt: string
  parentGroupId: string | null
  sweepId: string | null
  sweepVariables: unknown
  batchId: string | null
  batchVariables: unknown
  chainTotal: number | null
  chainIntro: string | null
  stages: unknown
  userServices: unknown
  deletedAt: string | null
  deletedBy: string | null
  apiKeyId: string | null
  lessonId: string | null
  jobs: BatchGroupJob[]
}

export interface BatchDetail extends Batch {
  projectPromptPrefix: string
  projectPromptSuffix: string
  groups: BatchGroup[]
}

/** One attachment target: a Note hangs off exactly one of a Project, a JobGroup, or a Job. */
export type NoteTarget =
  | { level: 'project'; projectId: string }
  | { level: 'group'; jobGroupId: string }
  | { level: 'job'; jobId: string }

export type NoteListTarget = NoteTarget & { scope?: 'all' | 'project' }

export interface Note {
  id: string
  projectId: string
  jobGroupId: string | null
  jobId: string | null
  body: string
  author: 'human' | 'api'
  createdBy: string | null
  createdAt: string
  updatedAt: string
}
