// ─── Auth / Users ────────────────────────────────────────────────────
export interface InstitutionStub {
  id: number
  name: string
  slug: string
  ref_prefix: string
  role: string
}

export interface User {
  id: number
  username: string
  email: string
  is_system_admin: boolean
  active_institution: InstitutionStub | null
  institutions: InstitutionStub[]
}

// ─── Hierarchy ───────────────────────────────────────────────────────
export type HierarchyEntityType = 'resource' | 'location' | 'classification'

export interface HierarchyType {
  id: number
  institution_id: number
  name: string
  description: string | null
  entity_type: HierarchyEntityType
  is_default: boolean
}

export interface MetadataField {
  name: string
  label: string
  type: 'text' | 'textarea' | 'date' | 'number'
  required?: boolean
}

export interface HierarchyLevel {
  id: number
  hierarchy_type_id: number
  name: string
  description: string | null
  sort_order: number
  can_have_location: boolean
  metadata_schema: { fields: MetadataField[] } | null
}

// ─── Nodes ───────────────────────────────────────────────────────────
export type NodeStatus = 'draft' | 'published' | 'restricted'

export interface NodeStub {
  id: number
  title: string
  ref_code: string
  local_ref: string
  level_of_description: string
  status: NodeStatus
  date_start: string | null
  date_end: string | null
  has_children: boolean
  parent_id: number | null
}

export interface BreadcrumbItem {
  id: number
  title: string
  ref_code: string
}

export interface NodeAttachment {
  id: number
  original_filename: string
  file_size: number
  mime_type: string
  description: string | null
  uploaded_at: string
  uploaded_by: string | null
}

export interface NodeNote {
  id: number
  note_type: string
  content: string
  is_public: boolean
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface NodeDetail extends NodeStub {
  open_flag_count: number
  current_location_id: number | null
  current_location_status: string | null
  institution_id: number
  hierarchy_type_id: number
  hierarchy_type_name: string | null
  description: string | null
  scope_and_content: string | null
  arrangement: string | null
  access_conditions: string | null
  reproduction_conditions: string | null
  language: string | null
  finding_aids: string | null
  extent: string | null
  date_certainty: string | null
  metadata_spec: Record<string, unknown>
  metadata_fields: MetadataField[]
  breadcrumb: BreadcrumbItem[]
  children_count: number
  can_have_location: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  attachments: NodeAttachment[]
  notes: NodeNote[]
}

// ─── Agents ──────────────────────────────────────────────────────────
export type AgentType = 'person' | 'organization' | 'family' | 'software'

export interface AgentStub {
  id: number
  name: string
  agent_type: AgentType
  authorized_form: string | null
  date_from: string | null
  date_to: string | null
  identifier: string | null
}

export interface AgentRelation {
  agent: { id: number; name: string; agent_type: AgentType }
  association_type: string
  direction: 'outgoing' | 'incoming'
}

export interface AgentDetail extends AgentStub {
  institution_id: number
  description: string | null
  website: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  notes: AgentNote[]
  relations: AgentRelation[]
  node_count: number
}

export interface AgentNote {
  id: number
  note_type: string
  content: string
  created_at: string
  created_by: string | null
}

// ─── Locations ───────────────────────────────────────────────────────
export interface LocationStub {
  id: number
  name: string
  code: string
  level_name: string
  can_store_nodes: boolean
  capacity: number | null
  available_capacity: number | null
  stored_count: number
  parent_id: number | null
  has_children: boolean
}

export interface LocationDetail extends LocationStub {
  institution_id: number
  description: string | null
  full_path: string
  hierarchy_type_id: number
  created_at: string
}

// ─── Classifications ─────────────────────────────────────────────────
export interface ClassificationStub {
  id: number
  name: string
  code: string
  full_code: string
  level_name: string
  is_active: boolean
  valid_from: string | null
  valid_to: string | null
  parent_id: number | null
  has_children: boolean
  node_count: number
}

// ─── Shared ───────────────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[]
  meta: {
    page: number
    per_page: number
    total: number
    pages: number
  }
}

export interface ApiResponse<T> {
  status: 'success' | 'error'
  data?: T
  message?: string
  meta?: {
    page: number
    per_page: number
    total: number
    pages: number
  }
}