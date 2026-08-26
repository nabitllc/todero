// Static config defining all issue types, their fields, and metadata.
// Drives admin views and validation without requiring DB changes.
// See TOD-1299.

export type FieldType = 'text' | 'select' | 'date' | 'boolean' | 'textarea'

export interface FieldDefinition {
  name: string
  label: string
  fieldType: FieldType
  required: boolean
  defaultValue?: string | boolean | null
  validationRule?: string
  options?: string[]
}

export interface IssueTypeConfig {
  id: string
  label: string
  icon: string
  description: string
  enabled: boolean
  fields: FieldDefinition[]
}

// ── Shared fields used across multiple types ───────────────────────────────

const CORE_FIELDS: FieldDefinition[] = [
  { name: 'title',               label: 'Title',               fieldType: 'text',     required: true,  validationRule: 'max:200' },
  { name: 'description',         label: 'Description',         fieldType: 'textarea', required: false },
  { name: 'status',              label: 'Status',              fieldType: 'select',   required: true,  defaultValue: 'backlog',
    options: ['backlog','defined','refined','open','in_progress','code_review','product_review','approved','released','underway','feature_review','draft','active','wrapped','completed','closed'] },
  // no-invented-projects-sweep: this options list read
  //   ['Todero','Kemuni','Vespera','Infrastructure','Mission Control']
  // — a dropdown offering the operator two projects that do not exist. 'Kemuni'
  // and 'Vespera' are gone; 'Limiglow' (the one real managed project) takes their
  // place. 'Infrastructure' and 'Mission Control' remain only because they still
  // carry legacy task-key prefixes for historical rows (see PROJECT_PREFIX in
  // lib/constants.ts); they are not targets for new work.
  //
  // This list should ultimately come from GET /api/projects, not from source.
  // That change belongs to the sibling piece no-invented-projects.md, which owns
  // the screens; this file is static config that admin views read, and swapping
  // it for a fetch here would change its type from data to promise. Recorded
  // rather than silently left alone.
  { name: 'project',             label: 'Project',             fieldType: 'select',   required: true,
    options: ['Todero','Limiglow','Infrastructure','Mission Control'] },
  { name: 'priority',            label: 'Priority',            fieldType: 'select',   required: true,  defaultValue: 'medium',
    options: ['critical','high','medium','low'] },
  // no-invented-projects-sweep: 'kemuni-sme' and 'vespera-sme' were offered in
  // both lists. Assigning an issue to an agent that does not exist parks it
  // forever — no queue lane claims it and no watchdog notices.
  { name: 'assignee',            label: 'Assignee',            fieldType: 'select',   required: true,
    options: ['builder','ops','tester','designer','po','scout','main','infra-sme','todero-sme'] },
  { name: 'owner',               label: 'Owner',               fieldType: 'select',   required: false,
    options: ['builder','ops','tester','designer','po','scout','main','infra-sme','todero-sme'] },
  { name: 'reviewer',            label: 'Reviewer',            fieldType: 'select',   required: false,
    options: ['tester','designer','po','main'] },
  { name: 'sprint',              label: 'Sprint',              fieldType: 'date',     required: false },
  { name: 'due_date',            label: 'Due Date',            fieldType: 'date',     required: false },
  { name: 'parent_id',           label: 'Parent Issue',        fieldType: 'text',     required: false },
  { name: 'task_key',            label: 'Issue Key',           fieldType: 'text',     required: false, validationRule: 'readonly' },
  { name: 'created_at',          label: 'Created At',          fieldType: 'date',     required: false, validationRule: 'readonly' },
  { name: 'updated_at',          label: 'Updated At',          fieldType: 'date',     required: false, validationRule: 'readonly' },
]

const WORKFLOW_FIELDS: FieldDefinition[] = [
  { name: 'acceptance_criteria',  label: 'Acceptance Criteria',  fieldType: 'textarea', required: false },
  { name: 'implementation_notes', label: 'Implementation Notes', fieldType: 'textarea', required: false },
  { name: 'reviewer_notes',       label: 'Reviewer Notes',       fieldType: 'textarea', required: false },
  { name: 'regression_test',      label: 'Regression Test',      fieldType: 'textarea', required: false },
  { name: 'resolution_type',      label: 'Resolution Type',      fieldType: 'select',   required: false,
    options: ['code_change','config_change','database_change','research_completed','documentation','duplicate','by_design','expected_behavior','wont_fix','not_reproducible','deferred','no_change_required','no_action','completed','cancelled'] },
  { name: 'commit_sha',           label: 'Commit SHA',           fieldType: 'text',     required: false },
  { name: 'pr_url',               label: 'PR URL',               fieldType: 'text',     required: false },
  { name: 'feature_branch',       label: 'Feature Branch',       fieldType: 'text',     required: false },
  { name: 'started_at',           label: 'Started At',           fieldType: 'date',     required: false, validationRule: 'readonly' },
  { name: 'completed_at',         label: 'Completed At',         fieldType: 'date',     required: false, validationRule: 'readonly' },
]

const REVIEW_FIELDS: FieldDefinition[] = [
  { name: 'test_status',          label: 'Test Status',          fieldType: 'select',   required: false,
    options: ['passed','failed','skipped'] },
  { name: 'tester_status',        label: 'Tester Status',        fieldType: 'select',   required: false,
    options: ['approved','rejected','pending'] },
  { name: 'tester_notes',         label: 'Tester Notes',         fieldType: 'textarea', required: false },
  { name: 'tested_by',            label: 'Tested By',            fieldType: 'text',     required: false },
  { name: 'tester_reviewed_at',   label: 'Tester Reviewed At',   fieldType: 'date',     required: false, validationRule: 'readonly' },
  { name: 'designer_status',      label: 'Designer Status',      fieldType: 'select',   required: false,
    options: ['approved','rejected','pending'] },
  { name: 'designer_notes',       label: 'Designer Notes',       fieldType: 'textarea', required: false },
  { name: 'designed_by',          label: 'Designed By',          fieldType: 'text',     required: false },
  { name: 'designer_reviewed_at', label: 'Designer Reviewed At', fieldType: 'date',     required: false, validationRule: 'readonly' },
  { name: 'worked_by',            label: 'Worked By',            fieldType: 'text',     required: false },
]

const SEVERITY_FIELD: FieldDefinition = {
  name: 'severity', label: 'Severity', fieldType: 'select', required: false,
  options: ['S0','S1','S2','S3'],
  validationRule: 'S0=user-facing; S1=API/schema; S2=config/infra; S3=cosmetic',
}

const TEST_TIER_FIELD: FieldDefinition = {
  name: 'test_tier', label: 'Test Tier', fieldType: 'select', required: false,
  options: ['smoke','integration','e2e'],
  validationRule: 'Required for task, bug, ops before refined transition',
}

const BLOCKING_FIELDS: FieldDefinition[] = [
  { name: 'blocked_by',    label: 'Blocked By',    fieldType: 'text',    required: false },
  { name: 'is_blocked',    label: 'Is Blocked',    fieldType: 'boolean', required: false, defaultValue: false },
]

const REJECTION_FIELDS: FieldDefinition[] = [
  { name: 'rejection_count',        label: 'Rejection Count',        fieldType: 'text',     required: false, validationRule: 'readonly' },
  { name: 'last_rejection_reason',  label: 'Last Rejection Reason',  fieldType: 'textarea', required: false, validationRule: 'readonly' },
]

const DEPLOYER_FIELDS: FieldDefinition[] = [
  { name: 'deployer_status', label: 'Deployer Status', fieldType: 'select',   required: false, options: ['ready','failed'] },
  { name: 'deployer_notes',  label: 'Deployer Notes',  fieldType: 'textarea', required: false },
]

const CLOSING_FIELDS: FieldDefinition[] = [
  { name: 'closing_notes',    label: 'Closing Notes',    fieldType: 'textarea', required: false },
  { name: 'status_category',  label: 'Status Category',  fieldType: 'select',   required: false,
    options: ['Planned','Ongoing','SignOff','Done'] },
]

// ── Issue type definitions ─────────────────────────────────────────────────

export const ISSUE_TYPE_CONFIG: IssueTypeConfig[] = [
  {
    id: 'epic',
    label: 'Epic',
    icon: '🗺️',
    description: 'Large multi-sprint theme. Decomposed into features by a Hub SME.',
    enabled: true,
    fields: [
      ...CORE_FIELDS,
      { name: 'acceptance_criteria', label: 'Acceptance Criteria', fieldType: 'textarea', required: true },
      { name: 'implementation_notes', label: 'Implementation Notes', fieldType: 'textarea', required: false },
      { name: 'reviewer_notes', label: 'Reviewer Notes', fieldType: 'textarea', required: false },
      { name: 'resolution_type', label: 'Resolution Type', fieldType: 'select', required: false,
        options: ['completed','deferred','wont_fix','duplicate','cancelled'] },
      { name: 'closing_notes', label: 'Closing Notes', fieldType: 'textarea', required: false },
      ...CLOSING_FIELDS.filter(f => f.name === 'status_category'),
      ...REJECTION_FIELDS,
    ],
  },
  {
    id: 'feature',
    label: 'Feature',
    icon: '✨',
    description: 'Shippable capability with clear AC. Parent of tasks. Decomposed by PO.',
    enabled: true,
    fields: [
      ...CORE_FIELDS,
      { name: 'acceptance_criteria', label: 'Acceptance Criteria', fieldType: 'textarea', required: true },
      { name: 'implementation_notes', label: 'Implementation Notes', fieldType: 'textarea', required: false },
      { name: 'reviewer_notes', label: 'Reviewer Notes', fieldType: 'textarea', required: false },
      { name: 'resolution_type', label: 'Resolution Type', fieldType: 'select', required: false,
        options: ['completed','deferred','wont_fix','duplicate','no_change_required','cancelled'] },
      ...CLOSING_FIELDS,
      ...REJECTION_FIELDS,
    ],
  },
  {
    id: 'task',
    label: 'Task',
    icon: '✅',
    description: 'Single implementable unit (1-2 days). Belongs to a parent Feature.',
    enabled: true,
    fields: [
      ...CORE_FIELDS,
      SEVERITY_FIELD,
      TEST_TIER_FIELD,
      { name: 'acceptance_criteria', label: 'Acceptance Criteria', fieldType: 'textarea', required: false },
      ...WORKFLOW_FIELDS,
      ...REVIEW_FIELDS,
      ...BLOCKING_FIELDS,
      ...REJECTION_FIELDS,
      ...DEPLOYER_FIELDS,
      ...CLOSING_FIELDS,
    ],
  },
  {
    id: 'bug',
    label: 'Bug',
    icon: '🐛',
    description: 'Something broken. References an affected Feature. Fixed by builder.',
    enabled: true,
    fields: [
      ...CORE_FIELDS,
      SEVERITY_FIELD,
      TEST_TIER_FIELD,
      { name: 'acceptance_criteria',  label: 'Acceptance Criteria',  fieldType: 'textarea', required: false },
      { name: 'steps_to_reproduce',   label: 'Steps to Reproduce',   fieldType: 'textarea', required: false },
      { name: 'expected_behavior',    label: 'Expected Behavior',     fieldType: 'textarea', required: false },
      { name: 'actual_behavior',      label: 'Actual Behavior',       fieldType: 'textarea', required: false },
      { name: 'environment',          label: 'Environment',           fieldType: 'text',     required: false },
      ...WORKFLOW_FIELDS,
      ...REVIEW_FIELDS,
      ...BLOCKING_FIELDS,
      ...REJECTION_FIELDS,
      ...DEPLOYER_FIELDS,
      ...CLOSING_FIELDS,
    ],
  },
  {
    id: 'ops',
    label: 'Ops',
    icon: '⚙️',
    description: 'Config, infra, or setup work. Assigned to ops agent. Standalone OK.',
    enabled: true,
    fields: [
      ...CORE_FIELDS,
      SEVERITY_FIELD,
      TEST_TIER_FIELD,
      { name: 'acceptance_criteria',  label: 'Acceptance Criteria',  fieldType: 'textarea', required: false },
      ...WORKFLOW_FIELDS,
      ...REVIEW_FIELDS,
      ...BLOCKING_FIELDS,
      ...REJECTION_FIELDS,
      ...DEPLOYER_FIELDS,
      ...CLOSING_FIELDS,
    ],
  },
  {
    id: 'research',
    label: 'Research',
    icon: '🔍',
    description: 'Evaluate options, gather findings. Goes to product_review, not code_review.',
    enabled: true,
    fields: [
      ...CORE_FIELDS,
      { name: 'acceptance_criteria',  label: 'Acceptance Criteria',  fieldType: 'textarea', required: false },
      { name: 'implementation_notes', label: 'Implementation Notes', fieldType: 'textarea', required: false },
      { name: 'reviewer_notes',       label: 'Reviewer Notes',       fieldType: 'textarea', required: false },
      { name: 'resolution_type', label: 'Resolution Type', fieldType: 'select', required: false,
        options: ['research_completed','documentation','deferred','wont_fix','duplicate','no_change_required'] },
      ...BLOCKING_FIELDS,
      ...REJECTION_FIELDS,
      ...CLOSING_FIELDS,
    ],
  },
]

// ── Lookup helpers ─────────────────────────────────────────────────────────

export function getIssueTypeConfig(typeId: string): IssueTypeConfig | undefined {
  return ISSUE_TYPE_CONFIG.find(t => t.id === typeId)
}

export function getEnabledIssueTypes(): IssueTypeConfig[] {
  return ISSUE_TYPE_CONFIG.filter(t => t.enabled)
}

export function getFieldDefinition(typeId: string, fieldName: string): FieldDefinition | undefined {
  return getIssueTypeConfig(typeId)?.fields.find(f => f.name === fieldName)
}
