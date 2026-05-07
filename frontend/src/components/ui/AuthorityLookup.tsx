import { useState, useEffect, useRef } from 'react'
import { Search, Loader, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import api from '@/api/client'
import type { ExternalIntegration } from '@/types'
import styles from './AuthorityLookup.module.css'

export interface AuthorityResult {
  name: string
  authorized_form?: string
  agent_type?: 'person' | 'organization' | 'family' | 'software'
  date_from?: string
  date_to?: string
  description?: string
  identifier: string
  website?: string
  source: string
  source_url?: string
}

interface SearchHit {
  id: string
  label: string
  description?: string
  source: string
  source_colour: string
  resolveType: 'wikidata' | 'viaf' | 'orcid' | 'integration'
  resolvePayload: string | Record<string, any>
}

const BUILTIN_COLOURS: Record<string, string> = {
  wikidata: '#006699',
  viaf:     '#8B4513',
  orcid:    '#A6CE39',
}

function integrationColour(id: number): string {
  const palette = ['#7B5EA7', '#2E86AB', '#A23B72', '#F18F01', '#C73E1D', '#3B1F2B']
  return palette[id % palette.length]
}

async function fetchDisabledBuiltins(): Promise<string[]> {
  const res = await api.get<{ status: string; data: any }>('/auth/institutions/current')
  return res.data.data?.settings?.disabled_builtins ?? []
}

async function fetchIntegrations(entityType: string): Promise<ExternalIntegration[]> {
  const res = await api.get<{ status: string; data: ExternalIntegration[] }>(
    '/integrations', { params: { entity_type: entityType } }
  )
  return res.data.data ?? []
}

async function fetchIntegrationSearch(id: number, q: string): Promise<Record<string, any>[]> {
  const res = await api.get<{ status: string; data: Record<string, any>[] }>(
    `/integrations/${id}/search`, { params: { q } }
  )
  return res.data.data ?? []
}

async function searchWikidata(q: string): Promise<SearchHit[]> {
  const url =
    `https://www.wikidata.org/w/api.php?action=wbsearchentities` +
    `&search=${encodeURIComponent(q)}&language=en&limit=5&format=json&origin=*`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  return (data.search ?? []).map((item: any): SearchHit => ({
    id: item.id, label: item.label ?? item.id, description: item.description,
    source: 'Wikidata', source_colour: BUILTIN_COLOURS.wikidata,
    resolveType: 'wikidata', resolvePayload: item.id,
  }))
}

async function searchVIAF(q: string): Promise<SearchHit[]> {
  const res = await fetch(`https://www.viaf.org/viaf/AutoSuggest?query=${encodeURIComponent(q)}`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.result ?? []).slice(0, 5).map((item: any): SearchHit => ({
    id: item.viafid, label: item.term ?? item.viafid, description: item.nametype,
    source: 'VIAF', source_colour: BUILTIN_COLOURS.viaf,
    resolveType: 'viaf', resolvePayload: item.viafid,
  }))
}

async function searchORCID(q: string): Promise<SearchHit[]> {
  const res = await fetch(
    `https://pub.orcid.org/v3.0/expanded-search?q=${encodeURIComponent(q)}&rows=5`,
    { headers: { Accept: 'application/json' } }
  )
  if (!res.ok) return []
  const data = await res.json()
  return (data['expanded-result'] ?? []).map((item: any): SearchHit => {
    const label = [item['given-names'], item['family-names']].filter(Boolean).join(' ') || item['orcid-id']
    return {
      id: item['orcid-id'], label, description: `ORCID: ${item['orcid-id']}`,
      source: 'ORCID', source_colour: BUILTIN_COLOURS.orcid,
      resolveType: 'orcid', resolvePayload: item['orcid-id'],
    }
  })
}

async function searchIntegration(intg: ExternalIntegration, q: string): Promise<SearchHit[]> {
  const items = await fetchIntegrationSearch(intg.id, q)
  return items.map((item): SearchHit => ({
    id:             item['identifier'] != null ? String(item['identifier']) : String(Math.random()),
    label:          item['name']        != null ? String(item['name'])       : '(unnamed)',
    description:    item['description'] != null ? String(item['description']): undefined,
    source:         intg.name,
    source_colour:  integrationColour(intg.id),
    resolveType:    'integration',
    resolvePayload: item,
  }))
}

async function resolveWikidata(qid: string): Promise<AuthorityResult> {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&languages=en&props=labels|descriptions|claims&format=json&origin=*`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Wikidata request failed')
  const data = await res.json()
  const entity = data.entities?.[qid]
  if (!entity || entity.missing !== undefined) throw new Error('Not found')
  const label = entity.labels?.en?.value ?? ''
  const description = entity.descriptions?.en?.value ?? ''
  const claims = entity.claims ?? {}
  const instanceOf = claims.P31?.[0]?.mainsnak?.datavalue?.value?.id
  const ORG_TYPES = ['Q43229','Q4830453','Q3918','Q7210356','Q15911314','Q783794','Q7188','Q2659904','Q748019']
  let agent_type: AuthorityResult['agent_type'] = 'person'
  if (instanceOf && ORG_TYPES.includes(instanceOf)) agent_type = 'organization'
  const toYear = (v: any) => v?.time?.replace(/^\+/, '').slice(0, 4) ?? ''
  const isOrg = agent_type === 'organization'
  return {
    name: label, authorized_form: label, agent_type,
    date_from: toYear(claims[isOrg ? 'P571' : 'P569']?.[0]?.mainsnak?.datavalue?.value),
    date_to:   toYear(claims[isOrg ? 'P576' : 'P570']?.[0]?.mainsnak?.datavalue?.value),
    description, identifier: `wikidata:${qid}`,
    website: claims.P856?.[0]?.mainsnak?.datavalue?.value ?? '',
    source: 'wikidata', source_url: `https://www.wikidata.org/wiki/${qid}`,
  }
}

async function resolveVIAF(viafId: string): Promise<AuthorityResult> {
  const res = await fetch(`https://viaf.org/viaf/${viafId}/viaf.json`)
  if (!res.ok) throw new Error('Not found on VIAF')
  const data = await res.json()
  let name = ''
  const headings = data.mainHeadings?.data
  if (Array.isArray(headings) && headings.length > 0) name = headings[0].text ?? ''
  else if (typeof headings === 'object' && headings?.text) name = headings.text
  let agent_type: AuthorityResult['agent_type'] = 'person'
  if (data.nameType === 'Corporate' || data.nameType === 'Geographic') agent_type = 'organization'
  return {
    name: name || `VIAF ${viafId}`, authorized_form: name || undefined, agent_type,
    date_from: data.birthDate || undefined, date_to: data.deathDate || undefined,
    identifier: `viaf:${viafId}`, source: 'viaf', source_url: `https://viaf.org/viaf/${viafId}`,
  }
}

async function resolveORCID(orcidId: string): Promise<AuthorityResult> {
  const res = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/person`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('Not found on ORCID')
  const data = await res.json()
  const given = data.name?.['given-names']?.value ?? ''
  const family = data.name?.['family-name']?.value ?? ''
  const name = [given, family].filter(Boolean).join(' ')
  return {
    name: name || orcidId,
    authorized_form: data.name?.['credit-name']?.value || name || undefined,
    agent_type: 'person', description: data.biography?.content ?? undefined,
    identifier: `orcid:${orcidId}`,
    website: data['researcher-urls']?.['researcher-url']?.[0]?.url?.value ?? undefined,
    source: 'orcid', source_url: `https://orcid.org/${orcidId}`,
  }
}

function resolveIntegration(payload: Record<string, any>): AuthorityResult {
  const integrationName = payload['_integration_name'] != null ? String(payload['_integration_name']) : 'custom'
  const str = (key: string) => { const v = payload[key]; return v != null ? String(v) : undefined }
  return {
    name: str('name') ?? '(unnamed)', authorized_form: str('authorized_form'),
    agent_type: payload['agent_type'] as AuthorityResult['agent_type'] | undefined,
    date_from: str('date_from'), date_to: str('date_to'), description: str('description'),
    identifier: str('identifier') ?? `${integrationName}:unknown`,
    website: str('website'), source: integrationName, source_url: str('source_url'),
  }
}

interface AuthorityLookupProps {
  onApply: (result: AuthorityResult) => void
  entityType?: string
}

export default function AuthorityLookup({ onApply, entityType = 'agent' }: AuthorityLookupProps) {
  const [query, setQuery]         = useState('')
  const [debouncedQ, setDQ]       = useState('')
  const [resolving, setResolving] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDQ(query.trim()), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const { data: disabledBuiltins = [] } = useQuery<string[]>({
    queryKey:  ['institution-disabled-builtins'],
    queryFn:   fetchDisabledBuiltins,
    staleTime: 60_000,
  })

  const { data: integrations = [] } = useQuery<ExternalIntegration[]>({
    queryKey:  ['integrations', entityType],
    queryFn:   () => fetchIntegrations(entityType),
    staleTime: 60_000,
  })

  const enabledBuiltinLabels = ['Wikidata', 'VIAF', 'ORCID'].filter(
    (_, i) => !disabledBuiltins.includes(['wikidata','viaf','orcid'][i])
  )
  const allSourceNames = [...enabledBuiltinLabels, ...integrations.map(i => i.name)]

  const { data: hits = [], isFetching } = useQuery<SearchHit[]>({
    queryKey: ['authority-search', debouncedQ, disabledBuiltins, integrations.map(i => i.id)],
    queryFn: async () => {
      if (debouncedQ.length < 2) return []
      const sources: Promise<SearchHit[]>[] = [
        ...(!disabledBuiltins.includes('wikidata') ? [searchWikidata(debouncedQ)] : []),
        ...(!disabledBuiltins.includes('viaf')     ? [searchVIAF(debouncedQ)]     : []),
        ...(!disabledBuiltins.includes('orcid')    ? [searchORCID(debouncedQ)]    : []),
        ...integrations.map(intg => searchIntegration(intg, debouncedQ).catch(() => [] as SearchHit[])),
      ]
      const settled = await Promise.allSettled(sources)
      return settled.flatMap(r => r.status === 'fulfilled' ? r.value : [])
    },
    enabled:   debouncedQ.length >= 2,
    staleTime: 30_000,
  })

  const handleSelect = async (hit: SearchHit) => {
    setResolving(true)
    try {
      let result: AuthorityResult
      if      (hit.resolveType === 'wikidata') result = await resolveWikidata(hit.resolvePayload as string)
      else if (hit.resolveType === 'viaf')      result = await resolveVIAF(hit.resolvePayload as string)
      else if (hit.resolveType === 'orcid')     result = await resolveORCID(hit.resolvePayload as string)
      else                                       result = resolveIntegration(hit.resolvePayload as Record<string, any>)
      onApply(result)
      setQuery('')
      setDQ('')
    } catch {
      // keep list open so user can retry
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Authority lookup</span>
        <span className={styles.hint}>
          {allSourceNames.length > 0
            ? `Search ${allSourceNames.join(', ')}`
            : 'No sources enabled — configure in Administration → Integrations'}
        </span>
      </div>

      <div className={styles.inputRow}>
        {(isFetching || resolving)
          ? <Loader size={14} className={`${styles.inputIcon} ${styles.spinner}`} />
          : <Search size={14} className={styles.inputIcon} />
        }
        <input
          className={styles.input}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Type a name to search…"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      {debouncedQ.length >= 2 && !isFetching && hits.length === 0 && (
        <div className={styles.empty}>No results found</div>
      )}

      {hits.length > 0 && (
        <div className={styles.results}>
          {hits.map((hit, i) => (
            <button
              key={`${hit.source}-${hit.id}-${i}`}
              className={styles.resultRow}
              onClick={() => handleSelect(hit)}
              disabled={resolving}
            >
              <span className={styles.sourceBadge} style={{ background: hit.source_colour }}>
                {hit.source}
              </span>
              <span className={styles.hitLabel}>{hit.label}</span>
              {hit.description && <span className={styles.hitDesc}>{hit.description}</span>}
              <ChevronRight size={12} className={styles.hitArrow} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}