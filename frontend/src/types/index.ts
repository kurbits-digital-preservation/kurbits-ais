// ─── Auth / Users ────────────────────────────────────────────────────
export interface InstitutionStub {
  id: number
  name: string
  slug: string
  ref_prefix: string
  role: string
  member_count?: number
  settings?: {
    disabled_builtins?: string[]
  }
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
  is_object_level: boolean
  metadata_schema: { fields: MetadataField[]; record_sources?: LevelSource[] } | null
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
  is_object: boolean
  representations: RepresentationStub[] 
  identifiers: NodeIdentifier[]
}

export interface NodeIdentifier {
  id: number
  node_id: number
  scheme_id: number
  scheme_name: string | null
  value: string
  is_primary: boolean
  note: string | null
  resolve_url: string | null
  created_at: string
  created_by: string | null
}

export interface IdentifierScheme {
  id: number
  name: string
  description: string | null
  url_template: string | null
  generator_url: string | null
  has_generator: boolean
  is_active: boolean
  sort_order: number
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
  other_names?: string[]
  other_names_total?: number
}

export interface AgentRelation {
  agent: { id: number; name: string; agent_type: AgentType }
  association_type: string
  direction: 'outgoing' | 'incoming'
}

export interface AgentNameFormType {
  id: number
  name: string
  description: string | null
  usage_count?: number
}

export interface AgentNameForm {
  id: number
  agent_id: number
  type_id: number
  type_name: string | null
  name: string
  date_from: string | null
  date_to: string | null
  created_at: string
  created_by: string | null
}

export interface AgentDetail extends AgentStub {
  institution_id: number
  description: string | null
  website: string | null
  metadata_spec: Record<string, unknown>
  metadata_fields: MetadataField[]
  created_at: string
  updated_at: string
  created_by: string | null
  notes: AgentNote[]
  name_forms: AgentNameForm[]
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

export interface ExternalIntegration {
  id: number
  name: string
  entity_type: string
  base_url: string
  search_path: string
  headers: Record<string, string>
  result_path: string
  field_mappings: Record<string, string>
  is_active: boolean
  has_headers?: boolean
  plugin?: string | null
  plugin_label?: string
  plugin_installed?: boolean
  config?: Record<string, unknown>
  secrets_set?: string[]
}

// ─── Representations ─────────────────────────────────────────────────

export interface RepresentationType {
  id: number
  name: string
  description: string | null
  sort_order: number
}

export interface RepresentationFile {
  id: number
  original_filename: string
  file_size: number
  mime_type: string
  description: string | null
  uploaded_at: string
  uploaded_by: string | null
  checksum_md5: string | null
  checksum_sha256: string | null
  pronom_id: string | null
  image_width: number | null
  image_height: number | null
  image_dpi_x: number | null
  image_dpi_y: number | null
  image_mode: string | null
  image_bit_depth: number | null
  duration_seconds: number | null
  av_codec: string | null
  av_bitrate: number | null
  has_thumbnail: boolean
  tech_extracted_at: string | null
  extracted_text?: string | null
  extracted_text_at?: string | null
}

export interface NodeRepresentation {
  id: number
  node_id: number
  rep_type_id: number
  rep_type_name: string | null
  label: string | null
  note: string | null
  created_at: string
  created_by: string | null
  files: RepresentationFile[]
}

export interface RepresentationStub {
  id: number
  rep_type_id: number
  rep_type_name: string | null
  label: string | null
  file_count: number
}
// ─── Source plugins ──────────────────────────────────────────────────
export type SourceFillMode = 'empty_only' | 'overwrite'

export interface SourceConfigField {
  key: string
  label: string
  type: 'text' | 'url' | 'textarea' | 'json'
  required: boolean
  secret: boolean
  default: unknown
  help: string | null
  placeholder: string | null
}

export interface SourcePluginInfo {
  key: string
  version: string
  label: string
  description: string
  search_hint: string
  supports: string[]
  config_schema: SourceConfigField[]
  enabled: boolean
}

export interface SourceNodeTarget {
  target: string
  field: string
  label: string
  type: string
}

export interface SourceKeyInfo {
  key: string
  label: string
  group: string | null
}

export interface SourceMapping {
  target: string
  sources: string[]
  scheme?: string
}

export interface LevelSource {
  integration_id: number
  fill_mode: SourceFillMode
  mappings: SourceMapping[]
}

export interface LevelSourceOption {
  integration_id: number
  name: string
  plugin: string
  plugin_label: string
  search_hint: string
  fill_mode: SourceFillMode
}

export interface SourceHit {
  external_id: string
  label: string
  description: string | null
}

export interface SourcePreviewRow {
  key: string
  kind: 'node' | 'meta' | 'identifier'
  field: string
  label: string
  source_key: string | null
  current: string
  proposed: string
  value: unknown
  scheme: string | null
  selectable: boolean
  selected: boolean
  status: 'unchanged' | 'attached' | 'conflict' | 'invalid' | null
  message: string | null
}

export interface SourcePreview {
  integration_id: number
  integration_name: string
  external_id: string
  label: string
  source_url: string | null
  fill_mode: SourceFillMode
  rows: SourcePreviewRow[]
  import_token: string
}

export interface SourceImport {
  integration_id: number
  integration_name: string
  external_id: string
  token: string
  identifiers: { scheme: string; value: string }[]
}

export interface SourceApplyResult {
  node: Record<string, string>
  meta: Record<string, unknown>
  sourceImport: SourceImport
}

export interface AgentTypeSchemaInfo {
  agent_type: AgentType
  metadata_schema: { fields: MetadataField[] }
}