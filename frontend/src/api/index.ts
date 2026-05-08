import api from './client'
import type {
  User, NodeStub, NodeDetail, AgentStub, AgentDetail,
  LocationStub, LocationDetail, ClassificationStub,ApiResponse, ExternalIntegration
} from '@/types'


// ─── Auth ────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ status: string; data: User }>('/auth/login', { email, password }),

  logout: () => api.post('/auth/logout'),

  me: () => api.get<{ status: string; data: User }>('/auth/me'),

  switchInstitution: (institution_id: number) =>
    api.post<{ status: string; data: User }>('/auth/switch-institution', { institution_id }),
}

// ─── Nodes ───────────────────────────────────────────────────────────
export const nodesApi = {
  getTree: (include_drafts = true) =>
    api.get<{ status: string; data: NodeStub[] }>('/nodes/tree', { params: { include_drafts } }),

  getChildren: (nodeId: number, include_drafts = true) =>
    api.get<{ status: string; data: NodeStub[] }>(`/nodes/${nodeId}/children`, { params: { include_drafts } }),

  get: (nodeId: number) =>
    api.get<{ status: string; data: NodeDetail }>(`/nodes/${nodeId}`),

  list: (params?: Record<string, unknown>) =>
    api.get<{ status: string; data: NodeStub[]; meta: object }>('/nodes', { params }),

  create: (data: Record<string, unknown>) =>
    api.post<{ status: string; data: NodeDetail }>('/nodes', data),

  update: (nodeId: number, data: Record<string, unknown>) =>
    api.patch<{ status: string; data: NodeDetail }>(`/nodes/${nodeId}`, data),

  delete: (nodeId: number) =>
    api.delete(`/nodes/${nodeId}`),

  updateStatus: (nodeId: number, status: string) =>
    api.patch(`/nodes/${nodeId}/status`, { status }),

  move: (nodeId: number, parent_id: number | null) =>
    api.patch<{ status: string; data: NodeDetail }>(`/nodes/${nodeId}/move`, { parent_id }),

  bulkMove: (node_ids: number[], parent_id: number | null) =>
  api.post<{ status: string; data: { moved: number[]; errors: any[] } }>('/nodes/bulk-move', { node_ids, parent_id }),

bulkDelete: (node_ids: number[], force = false) =>
  api.post<{ status: string; data: { deleted: number[]; errors: any[] } }>('/nodes/bulk-delete', { node_ids, force }),

  getHistory: (nodeId: number) =>
    api.get(`/nodes/${nodeId}/history`),

  revert: (nodeId: number, changeId: number) =>
    api.post(`/nodes/${nodeId}/revert/${changeId}`),

  getRelations: (nodeId: number) =>
    api.get(`/nodes/${nodeId}/relations`),

  addRelation: (nodeId: number, target_id: number, relation_type: string) =>
    api.post(`/nodes/${nodeId}/relations`, { target_id, relation_type }),

  removeRelation: (nodeId: number, targetId: number) =>
    api.delete(`/nodes/${nodeId}/relations/${targetId}`),

  addNote: (nodeId: number, data: object) =>
    api.post(`/nodes/${nodeId}/notes`, data),

  updateNote: (nodeId: number, noteId: number, data: object) =>
    api.patch(`/nodes/${nodeId}/notes/${noteId}`, data),

  deleteNote: (nodeId: number, noteId: number) =>
    api.delete(`/nodes/${nodeId}/notes/${noteId}`),

  uploadAttachment: (nodeId: number, formData: FormData) =>
    api.post(`/nodes/${nodeId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  deleteAttachment: (nodeId: number, attachmentId: number) =>
    api.delete(`/nodes/${nodeId}/attachments/${attachmentId}`),

  getThumbnailUrl: (nodeId: number, attachmentId: number) =>
    `/api/v1/nodes/${nodeId}/attachments/${attachmentId}/thumbnail`,

  getDownloadUrl: (nodeId: number, attachmentId: number) =>
    `/api/v1/nodes/${nodeId}/attachments/${attachmentId}/download`,


  printLabels: (nodeIds: number[], format: string, copies: number, includeDescendants = false) =>
  api.post('/nodes/labels', { node_ids: nodeIds, format, copies, include_descendants: includeDescendants }, { responseType: 'arraybuffer' }),

  findingAid: (nodeId: number) =>
    api.get(`/nodes/${nodeId}/finding-aid`, { responseType: 'blob' }),

  reextractMetadata: (nodeId: number, attachmentId: number) =>
    api.post(`/nodes/${nodeId}/attachments/${attachmentId}/extract`),

  getAttachmentUrl: (nodeId: number, attachmentId: number) =>
    `/api/v1/nodes/${nodeId}/attachments/${attachmentId}/download`,
    duplicate: (nodeId: number) =>
  api.post<{ status: string; data: NodeDetail }>(`/nodes/${nodeId}/duplicate`),
}

// ─── Agents ──────────────────────────────────────────────────────────
export const agentsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<{ status: string; data: AgentStub[]; meta: object }>('/agents', { params }),

  get: (agentId: number) =>
    api.get<{ status: string; data: AgentDetail }>(`/agents/${agentId}`),

  create: (data: Record<string, unknown>) =>
    api.post<{ status: string; data: AgentDetail }>('/agents', data),

  update: (agentId: number, data: Record<string, unknown>) =>
    api.patch<{ status: string; data: AgentDetail }>(`/agents/${agentId}`, data),

  delete: (agentId: number) => api.delete(`/agents/${agentId}`),

  getNodes: (agentId: number, q?: string) =>
    api.get(`/agents/${agentId}/nodes`, { params: { q } }),

  addNode: (agentId: number, node_id: number, relation_type: string) =>
    api.post(`/agents/${agentId}/nodes`, { node_id, relation_type }),

  removeNode: (agentId: number, nodeId: number) =>
    api.delete(`/agents/${agentId}/nodes/${nodeId}`),

  addRelation: (agentId: number, target_id: number, relation_type: string) =>
    api.post(`/agents/${agentId}/relations`, { target_id, relation_type }),

  removeRelation: (agentId: number, targetId: number) =>
    api.delete(`/agents/${agentId}/relations/${targetId}`),

  addNote: (agentId: number, data: object) =>
    api.post(`/agents/${agentId}/notes`, data),

  deleteNote: (agentId: number, noteId: number) =>
    api.delete(`/agents/${agentId}/notes/${noteId}`),

  getRelationTypes: () => api.get('/agents/relation-types'),
  getNodeRelationTypes: () => api.get('/agents/node-relation-types'),
}

// ─── Locations ───────────────────────────────────────────────────────
export const locationsApi = {
  getTree: () =>
    api.get<{ status: string; data: LocationStub[] }>('/locations/tree'),

  search: (q: string, storableOnly = false) =>
    api.get<{ status: string; data: any[] }>('/locations/search', {
      params: { q, storable: storableOnly },
    }),

  getChildren: (locationId: number) =>
    api.get<{ status: string; data: LocationStub[] }>(`/locations/${locationId}/children`),

  get: (locationId: number) =>
    api.get<{ status: string; data: LocationDetail }>(`/locations/${locationId}`),

  create: (data: Record<string, unknown>) =>
    api.post<{ status: string; data: LocationDetail }>('/locations', data),

  update: (locationId: number, data: Record<string, unknown>) =>
    api.patch<{ status: string; data: LocationDetail }>(`/locations/${locationId}`, data),

  delete: (locationId: number) => api.delete(`/locations/${locationId}`),

  getStoredNodes: (locationId: number) =>
    api.get(`/locations/${locationId}/nodes`),

  checkIn: (locationId: number, node_id: number, notes?: string) =>
    api.post(`/locations/${locationId}/check-in`, { node_id, notes }),

  move: (locationId: number, nodeId: number, targetLocationId: number, notes?: string) =>
    api.post(`/locations/${locationId}/move`, { node_id: nodeId, target_location_id: targetLocationId, notes }),

  checkOut: (locationId: number, node_id: number, notes?: string) =>
    api.post(`/locations/${locationId}/check-out`, { node_id, notes }),

  transfer: (locationId: number, node_id: number, target_location_id: number, notes?: string) =>
    api.post(`/locations/${locationId}/transfer`, { node_id, target_location_id, notes }),

  getMovements: (locationId: number, page = 1) =>
    api.get(`/locations/${locationId}/movements`, { params: { page } }),

  getNodeMovements: (nodeId: number) =>
    api.get<{ status: string; data: any[] }>(`/nodes/${nodeId}/movements`),

  inventory: (locationId: number) =>
    api.get(`/locations/${locationId}/inventory`, { responseType: 'blob' }),
}

// ─── Classifications ─────────────────────────────────────────────────
export const classificationsApi = {
  search: (q: string, schemeId?: number, publishedOnly = false) =>
    api.get<{ status: string; data: any[] }>('/classifications/search', { params: { q, scheme_id: schemeId, published_only: publishedOnly } }),

  listSchemes: (publishedOnly = false) =>
    api.get<{ status: string; data: any[] }>('/classifications/schemes', { params: { published_only: publishedOnly } }),

  validLevels: (hierarchyTypeId: number, parentId?: number) =>
    api.get<{ status: string; data: any[] }>('/classifications/valid-levels', {
      params: { hierarchy_type_id: hierarchyTypeId, parent_id: parentId },
    }),

  publish: (id: number, versionLabel?: string) =>
    api.post(`/classifications/${id}/publish`, { version_label: versionLabel }),

  retire: (id: number, recursive = false) =>
    api.post(`/classifications/${id}/retire`, null, { params: { recursive } }),

  updateDiagram: (id: number, diagram: string | null) =>
    api.patch(`/classifications/${id}/diagram`, { diagram }),

  createMajorVersion: (id: number, versionLabel?: string) =>
    api.post(`/classifications/${id}/major-version`, { version_label: versionLabel }),

  importFile: (file: File, hierarchyTypeId: number) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('hierarchy_type_id', String(hierarchyTypeId))
    return api.post('/classifications/import', fd, {
      headers: { 'Content-Type': undefined },
    })
  },

  getTree: (hierarchy_type_id?: number) =>
    api.get<{ status: string; data: ClassificationStub[] }>('/classifications/tree', {
      params: { hierarchy_type_id },
    }),

  getChildren: (classificationId: number) =>
    api.get<{ status: string; data: ClassificationStub[] }>(
      `/classifications/${classificationId}/children`
    ),

  get: (classificationId: number) =>
    api.get(`/classifications/${classificationId}`),

  create: (data: Record<string, unknown>) =>
    api.post('/classifications', data),

  update: (classificationId: number, data: Record<string, unknown>) =>
    api.patch(`/classifications/${classificationId}`, data),

  delete: (classificationId: number) =>
    api.delete(`/classifications/${classificationId}`),

  getNodes: (classificationId: number) =>
    api.get(`/classifications/${classificationId}/nodes`),

  addNode: (classificationId: number, node_id: number) =>
    api.post(`/classifications/${classificationId}/nodes`, { node_id }),

  removeNode: (classificationId: number, nodeId: number) =>
    api.delete(`/classifications/${classificationId}/nodes/${nodeId}`),

  getHistory: (classificationId: number) =>
    api.get(`/classifications/${classificationId}/history`),
}

// ─── Hierarchy management ─────────────────────────────────────────────
export const hierarchyApi = {
  listTypes: (entity_type?: string) =>
    api.get<{ status: string; data: any[] }>('/hierarchy/types', { params: { entity_type } }),

  createType: (data: Record<string, unknown>) =>
    api.post<{ status: string; data: any }>('/hierarchy/types', data),

  updateType: (typeId: number, data: Record<string, unknown>) =>
    api.patch<{ status: string; data: any }>(`/hierarchy/types/${typeId}`, data),

  deleteType: (typeId: number) =>
    api.delete(`/hierarchy/types/${typeId}`),

  listLevels: (typeId: number) =>
    api.get<{ status: string; data: any[] }>(`/hierarchy/types/${typeId}/levels`),

  createLevel: (typeId: number, data: Record<string, unknown>) =>
    api.post<{ status: string; data: any }>(`/hierarchy/types/${typeId}/levels`, data),

  updateLevel: (typeId: number, levelId: number, data: Record<string, unknown>) =>
    api.patch<{ status: string; data: any }>(`/hierarchy/types/${typeId}/levels/${levelId}`, data),

  deleteLevel: (typeId: number, levelId: number) =>
    api.delete(`/hierarchy/types/${typeId}/levels/${levelId}`),

  setLevelParents: (typeId: number, levelId: number, parent_ids: number[]) =>
    api.put<{ status: string; data: any }>(`/hierarchy/types/${typeId}/levels/${levelId}/parents`, { parent_ids }),
}

// ─── Node-side relation endpoints ────────────────────────────────────
export const nodeRelationsApi = {
  // Agents
  getAgents: (nodeId: number) =>
    api.get<{ status: string; data: any[] }>(`/nodes/${nodeId}/agents`),
  addAgent: (nodeId: number, agent_id: number, relation_type: string) =>
    api.post(`/nodes/${nodeId}/agents`, { agent_id, relation_type }),
  removeAgent: (nodeId: number, agentId: number) =>
    api.delete(`/nodes/${nodeId}/agents/${agentId}`),

  // Locations
  getLocations: (nodeId: number) =>
    api.get<{ status: string; data: any[] }>(`/nodes/${nodeId}/locations`),
  addLocation: (nodeId: number, location_id: number, notes?: string) =>
    api.post(`/nodes/${nodeId}/locations`, { location_id, notes }),
  removeLocation: (nodeId: number, locationId: number) =>
    api.delete(`/nodes/${nodeId}/locations/${locationId}`),

  moveLocation: (nodeId: number, from_location_id: number, to_location_id: number, notes?: string) =>
    api.post(`/nodes/${nodeId}/locations/move`, { from_location_id, to_location_id, notes }),

  // Classifications
  getClassifications: (nodeId: number) =>
    api.get<{ status: string; data: any[] }>(`/nodes/${nodeId}/classifications`),
  addClassification: (nodeId: number, classification_id: number) =>
    api.post(`/nodes/${nodeId}/classifications`, { classification_id }),
  removeClassification: (nodeId: number, classificationId: number) =>
    api.delete(`/nodes/${nodeId}/classifications/${classificationId}`),

  // Node-to-node
  getRelations: (nodeId: number) =>
    api.get(`/nodes/${nodeId}/relations`),
  addRelation: (nodeId: number, target_id: number, relation_type: string) =>
    api.post(`/nodes/${nodeId}/relations`, { target_id, relation_type }),
  removeRelation: (nodeId: number, targetId: number) =>
    api.delete(`/nodes/${nodeId}/relations/${targetId}`),
}

// ─── Institution admin ────────────────────────────────────────────────
export const institutionApi = {
  getCurrent: () =>
    api.get<{ status: string; data: any }>('/auth/institutions/current'),

  updateCurrent: (data: Record<string, unknown>) =>
    api.patch<{ status: string; data: any }>('/auth/institutions/current', data),

  listMembers: () =>
    api.get<{ status: string; data: any[] }>('/auth/institutions/current/members'),

  inviteUser: (data: Record<string, unknown>) =>
    api.post<{ status: string; data: any }>('/auth/institutions/current/invite', data),

  updateMemberRole: (institutionId: number, userId: number, role: string) =>
    api.patch(`/auth/institutions/${institutionId}/members/${userId}`, { role }),

  removeMember: (institutionId: number, userId: number) =>
    api.delete(`/auth/institutions/${institutionId}/members/${userId}`),
}

// ─── Vocabulary management ────────────────────────────────────────────
export const vocabApi = {
  // Agent ↔ agent relation types
  listAgentRelationTypes: () =>
    api.get<{ status: string; data: any[] }>('/agents/relation-types'),
  createAgentRelationType: (data: Record<string, unknown>) =>
    api.post<{ status: string; data: any }>('/agents/relation-types', data),
  updateAgentRelationType: (id: number, data: Record<string, unknown>) =>
    api.patch<{ status: string; data: any }>(`/agents/relation-types/${id}`, data),
  deleteAgentRelationType: (id: number) =>
    api.delete(`/agents/relation-types/${id}`),

  // Agent ↔ node relation types
  listAgentNodeRelationTypes: () =>
    api.get<{ status: string; data: any[] }>('/agents/node-relation-types'),
  createAgentNodeRelationType: (data: Record<string, unknown>) =>
    api.post<{ status: string; data: any }>('/agents/node-relation-types', data),
  updateAgentNodeRelationType: (id: number, data: Record<string, unknown>) =>
    api.patch<{ status: string; data: any }>(`/agents/node-relation-types/${id}`, data),
  deleteAgentNodeRelationType: (id: number) =>
    api.delete(`/agents/node-relation-types/${id}`),

  // Place types vocab
  listPlaceTypes: (applicableTo?: string) =>
    api.get<{ status: string; data: any[] }>('/vocab/place-types', { params: { applicable_to: applicableTo } }),
  createPlaceType: (data: Record<string, unknown>) =>
    api.post('/vocab/place-types', data),
  updatePlaceType: (id: number, data: Record<string, unknown>) =>
    api.patch(`/vocab/place-types/${id}`, data),
  deletePlaceType: (id: number) =>
    api.delete(`/vocab/place-types/${id}`),

  // Tag categories vocab
  listTagCategories: (applicableTo?: string) =>
    api.get<{ status: string; data: any[] }>('/vocab/tag-categories', { params: { applicable_to: applicableTo } }),
  createTagCategory: (data: Record<string, unknown>) =>
    api.post('/vocab/tag-categories', data),
  updateTagCategory: (id: number, data: Record<string, unknown>) =>
    api.patch(`/vocab/tag-categories/${id}`, data),
  deleteTagCategory: (id: number) =>
    api.delete(`/vocab/tag-categories/${id}`),

  // Node ↔ node relation types
  listNodeRelationTypes: () =>
    api.get<{ status: string; data: any[] }>('/nodes/relation-types'),
  createNodeRelationType: (data: Record<string, unknown>) =>
    api.post<{ status: string; data: any }>('/nodes/relation-types', data),
  updateNodeRelationType: (id: number, data: Record<string, unknown>) =>
    api.patch<{ status: string; data: any }>(`/nodes/relation-types/${id}`, data),
  deleteNodeRelationType: (id: number) =>
    api.delete(`/nodes/relation-types/${id}`),
}

// ─── EAD ─────────────────────────────────────────────────────────────
export const eadApi = {
  exportUrl: (nodeId: number, includeChildren = true) =>
    `/api/v1/nodes/${nodeId}/ead-export?include_children=${includeChildren}`,

  import: (formData: FormData) =>
    api.post<{ status: string; data: any }>('/ead-import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
}

// ─── Agents EAC-CPF import ───────────────────────────────────────────
export const agentsImportApi = {
  importEacCpf: (file: File, updateExisting = false) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('update_existing', String(updateExisting))
    return api.post<{ status: string; data: any }>('/agents/import/eaccpf', fd, {
      headers: { 'Content-Type': undefined },
    })
  },
}

// ─── Export ───────────────────────────────────────────────────────────
export const exportApi = {
  listFormats: () =>
    api.get<{ status: string; data: any[] }>('/export/formats'),

  exportUrl: (nodeId: number, format: string, includeChildren = true) =>
    `/api/v1/nodes/${nodeId}/export?format=${format}&include_children=${includeChildren}`,
}

// ─── OAI-PMH ─────────────────────────────────────────────────────────
export const oaiApi = {
  identify: (base_url: string) =>
    api.post<{ status: string; data: any }>('/oai/identify', { base_url }),

  listFormats: (base_url: string) =>
    api.post<{ status: string; data: any[] }>('/oai/formats', { base_url }),

  harvest: (data: Record<string, unknown>) =>
    api.post<{ status: string; data: any }>('/oai/harvest', data),
}

// ─── Global search ───────────────────────────────────────────────────
export const searchApi = {
  // Quick mode for cmd+K modal — capped at 8 results, no filters
  quick: (q: string) =>
    api.get<{ status: string; data: any }>('/search', { params: { q, quick: true } }),

  // Full search for the search page — supports all filters and pagination
  search: (params: {
    q: string
    types?: string
    status?: string
    level?: string
    hierarchy_type_id?: number
    date_from?: string
    date_to?: string
    agent_type?: string
    page?: number
    per_page?: number
  }) => api.get<{ status: string; data: any }>('/search', { params }),
}

// ─── Metadata templates ───────────────────────────────────────────────
export const templatesApi = {
  list: (entity_type?: string) =>
    api.get<{ status: string; data: any[] }>('/templates', { params: { entity_type } }),
  create: (data: Record<string, unknown>) =>
    api.post<{ status: string; data: any }>('/templates', data),
  update: (id: number, data: Record<string, unknown>) =>
    api.patch<{ status: string; data: any }>(`/templates/${id}`, data),
  delete: (id: number) =>
    api.delete(`/templates/${id}`),

  importFile: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<{ status: string; data: any }>('/templates/import', fd, {
      headers: { 'Content-Type': undefined },
    })
  },
}

// ─── Flags ────────────────────────────────────────────────────────────
export const flagsApi = {
  getNodeFlags: (nodeId: number) =>
    api.get<{ status: string; data: any[] }>(`/nodes/${nodeId}/flags`),
  createFlag: (nodeId: number, data: Record<string, unknown>) =>
    api.post(`/nodes/${nodeId}/flags`, data),
  updateFlag: (nodeId: number, flagId: number, data: Record<string, unknown>) =>
    api.patch(`/nodes/${nodeId}/flags/${flagId}`, data),
  deleteFlag: (nodeId: number, flagId: number) =>
    api.delete(`/nodes/${nodeId}/flags/${flagId}`),

  listAll: (params: {
    status?: string; flag_type?: string; severity?: string
    assigned_to_me?: boolean; unassigned?: boolean; page?: number
  }) => api.get<{ status: string; data: any }>('/flags', { params }),
}


export const placesApi = {
  getNodePlaces: (nodeId: number) =>
    api.get<{ status: string; data: any[] }>(`/nodes/${nodeId}/places`),
  addNodePlace: (nodeId: number, data: Record<string, unknown>) =>
    api.post(`/nodes/${nodeId}/places`, data),
  updateNodePlace: (nodeId: number, placeId: number, data: Record<string, unknown>) =>
    api.patch(`/nodes/${nodeId}/places/${placeId}`, data),
  deleteNodePlace: (nodeId: number, placeId: number) =>
    api.delete(`/nodes/${nodeId}/places/${placeId}`),

  getAgentPlaces: (agentId: number) =>
    api.get<{ status: string; data: any[] }>(`/agents/${agentId}/places`),
  addAgentPlace: (agentId: number, data: Record<string, unknown>) =>
    api.post(`/agents/${agentId}/places`, data),
  updateAgentPlace: (agentId: number, placeId: number, data: Record<string, unknown>) =>
    api.patch(`/agents/${agentId}/places/${placeId}`, data),
  deleteAgentPlace: (agentId: number, placeId: number) =>
    api.delete(`/agents/${agentId}/places/${placeId}`),
}

// ─── Tags ─────────────────────────────────────────────────────────────
export const tagsApi = {
  search: (q: string, category?: string) =>
    api.get<{ status: string; data: any[] }>('/tags/search', { params: { q, category } }),

  getNodeTags: (nodeId: number) =>
    api.get<{ status: string; data: any[] }>(`/nodes/${nodeId}/tags`),
  addNodeTag: (nodeId: number, name: string, category?: string) =>
    api.post(`/nodes/${nodeId}/tags`, { name, category }),
  removeNodeTag: (nodeId: number, tagId: number) =>
    api.delete(`/nodes/${nodeId}/tags/${tagId}`),

  getAgentTags: (agentId: number) =>
    api.get<{ status: string; data: any[] }>(`/agents/${agentId}/tags`),
  addAgentTag: (agentId: number, name: string, category?: string) =>
    api.post(`/agents/${agentId}/tags`, { name, category }),
  removeAgentTag: (agentId: number, tagId: number) =>
    api.delete(`/agents/${agentId}/tags/${tagId}`),
}

// ─── Acquisitions ─────────────────────────────────────────────────────
export const acquisitionsApi = {
  // Submission agreements
  listSAs: (params?: { status?: string; q?: string }) =>
    api.get<{ status: string; data: any[] }>('/submission-agreements', { params }),
  getSA: (id: number) =>
    api.get<{ status: string; data: any }>(`/submission-agreements/${id}`),
  createSA: (data: Record<string, unknown>) =>
    api.post<{ status: string; data: any }>('/submission-agreements', data),
  updateSA: (id: number, data: Record<string, unknown>) =>
    api.patch<{ status: string; data: any }>(`/submission-agreements/${id}`, data),
  deleteSA: (id: number) =>
    api.delete(`/submission-agreements/${id}`),
  uploadSAAttachment: (id: number, file: File, description?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    if (description) fd.append('description', description)
    return api.post(`/submission-agreements/${id}/attachments`, fd, {
      headers: { 'Content-Type': undefined },
    })
  },
  deleteSAAttachment: (saId: number, attId: number) =>
    api.delete(`/submission-agreements/${saId}/attachments/${attId}`),

  // Deliveries
  listDeliveries: (params?: { submission_agreement_id?: number; status?: string }) =>
    api.get<{ status: string; data: any[] }>('/deliveries', { params }),
  getDelivery: (id: number) =>
    api.get<{ status: string; data: any }>(`/deliveries/${id}`),
  createDelivery: (data: Record<string, unknown>) =>
    api.post<{ status: string; data: any }>('/deliveries', data),
  updateDelivery: (id: number, data: Record<string, unknown>) =>
    api.patch<{ status: string; data: any }>(`/deliveries/${id}`, data),
  deleteDelivery: (id: number) =>
    api.delete(`/deliveries/${id}`),
  updateChecklist: (id: number, checklist: any[]) =>
    api.patch(`/deliveries/${id}/checklist`, { checklist }),

  // Accessions
  listAccessions: (params?: { status?: string; delivery_id?: number; submission_agreement_id?: number }) =>
    api.get<{ status: string; data: any[] }>('/accessions', { params }),
  getAccession: (id: number) =>
    api.get<{ status: string; data: any }>(`/accessions/${id}`),
  createAccession: (data: Record<string, unknown>) =>
    api.post<{ status: string; data: any }>('/accessions', data),
  updateAccession: (id: number, data: Record<string, unknown>) =>
    api.patch<{ status: string; data: any }>(`/accessions/${id}`, data),
  deleteAccession: (id: number) =>
    api.delete(`/accessions/${id}`),
  getAccessionNodes: (id: number) =>
    api.get<{ status: string; data: any[] }>(`/accessions/${id}/nodes`),
  linkNode: (accessionId: number, nodeId: number) =>
    api.post(`/accessions/${accessionId}/nodes`, { node_id: nodeId }),
  unlinkNode: (accessionId: number, nodeId: number) =>
    api.delete(`/accessions/${accessionId}/nodes/${nodeId}`),
}

// ─── Checklist templates vocab ────────────────────────────────────────
export const checklistTemplatesApi = {
  list: () =>
    api.get<{ status: string; data: any[] }>('/vocab/checklist-templates'),
  create: (data: Record<string, unknown>) =>
    api.post<{ status: string; data: any }>('/vocab/checklist-templates', data),
  update: (id: number, data: Record<string, unknown>) =>
    api.patch<{ status: string; data: any }>(`/vocab/checklist-templates/${id}`, data),
  delete: (id: number) =>
    api.delete(`/vocab/checklist-templates/${id}`),
}

export const integrationsApi = {
  list: (entity_type?: string) =>
    api.get<ApiResponse<ExternalIntegration[]>>('/integrations', {
      params: entity_type ? { entity_type } : {},
    }).then(r => r.data.data!),

  create: (data: Omit<ExternalIntegration, 'id'>) =>
    api.post<ApiResponse<ExternalIntegration>>('/integrations', data).then(r => r.data.data!),

  update: (id: number, data: Partial<Omit<ExternalIntegration, 'id'>>) =>
    api.patch<ApiResponse<ExternalIntegration>>(`/integrations/${id}`, data).then(r => r.data.data!),

  delete: (id: number) =>
    api.delete(`/integrations/${id}`),

  search: (id: number, q: string) =>
    api.get<ApiResponse<Record<string, any>[]>>(`/integrations/${id}/search`, { params: { q } })
      .then(r => r.data.data!),
}

export const representationsApi = {
  // Vocabulary (admin)
  listTypes: () =>
    api.get('/representation-types'),
  createType: (data: { name: string; description?: string; sort_order?: number }) =>
    api.post('/representation-types', data),
  updateType: (id: number, data: Partial<{ name: string; description: string; sort_order: number }>) =>
    api.patch(`/representation-types/${id}`, data),
  deleteType: (id: number) =>
    api.delete(`/representation-types/${id}`),

  // Per-node representations
  list: (nodeId: number) =>
    api.get(`/nodes/${nodeId}/representations`),
  create: (nodeId: number, data: { rep_type_id: number; label?: string; note?: string }) =>
    api.post(`/nodes/${nodeId}/representations`, data),
  update: (nodeId: number, repId: number, data: Partial<{ rep_type_id: number; label: string; note: string }>) =>
    api.patch(`/nodes/${nodeId}/representations/${repId}`, data),
  delete: (nodeId: number, repId: number) =>
    api.delete(`/nodes/${nodeId}/representations/${repId}`),

  // Upload a file into a representation
  uploadFile: (nodeId: number, repId: number, formData: FormData) =>
    api.post(`/nodes/${nodeId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      params: { representation_id: repId },
    }),

  getDownloadUrl: (nodeId: number, fileId: number) =>
    `/api/v1/nodes/${nodeId}/attachments/${fileId}/download`,
  getThumbnailUrl: (nodeId: number, fileId: number) =>
    `/api/v1/nodes/${nodeId}/attachments/${fileId}/thumbnail`,

  deleteFile: (nodeId: number, fileId: number) =>
    api.delete(`/nodes/${nodeId}/attachments/${fileId}`),
  reextractFile: (nodeId: number, fileId: number) =>
    api.post(`/nodes/${nodeId}/attachments/${fileId}/extract`),
}

// ─── Saved searches ───────────────────────────────────────────────────
export const savedSearchesApi = {
  list: () =>
    api.get<{ status: string; data: any[] }>('/saved-searches'),

  create: (name: string, params: Record<string, string>) =>
    api.post<{ status: string; data: any }>('/saved-searches', { name, params }),

  delete: (id: number) =>
    api.delete(`/saved-searches/${id}`),
}

// ─── Recent / Bookmarks ───────────────────────────────────────────────
export const historyApi = {
  listRecent: () =>
    api.get<{ status: string; data: any[] }>('/recent'),

  trackRecent: (item: { entity_type: 'node' | 'agent'; entity_id: number; title: string; subtitle?: string }) =>
    api.post('/recent', item),

  listBookmarks: () =>
    api.get<{ status: string; data: any[] }>('/bookmarks'),

  addBookmark: (item: { entity_type: 'node' | 'agent'; entity_id: number; title: string; subtitle?: string }) =>
    api.post<{ status: string; data: any }>('/bookmarks', item),

  removeBookmark: (entity_type: 'node' | 'agent', entity_id: number) =>
    api.delete('/bookmarks', { data: { entity_type, entity_id } }),

  checkBookmark: (entity_type: 'node' | 'agent', entity_id: number) =>
    api.get<{ status: string; data: { bookmarked: boolean } }>('/bookmarks/check', {
      params: { entity_type, entity_id },
    }),
}


// ─── AI ───────────────────────────────────────────────────────────────
export const aiApi = {
  getConfig: () =>
    api.get<{ status: string; data: any }>('/ai/config'),

  saveConfig: (data: {
    provider: string
    model: string
    base_url?: string
    api_key?: string
    options?: Record<string, unknown>
    is_enabled?: boolean
  }) => api.put<{ status: string; data: any }>('/ai/config', data),

  testConfig: () =>
    api.post<{ status: string; data: { ok: boolean; message: string } }>('/ai/test'),

  getStatus: () =>
    api.get<{ status: string; data: { enabled: boolean; provider: string | null; model: string | null } }>('/ai/status'),
}

