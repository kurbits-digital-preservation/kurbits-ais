import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapPin, Plus, X, Pencil, Check, ExternalLink, Search, Loader } from 'lucide-react'
import { placesApi, vocabApi } from '@/api'
import { Spinner } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import styles from './PlacesPanel.module.css'

const WD_API = 'https://www.wikidata.org/w/api.php'

async function searchWikidata(q: string) {
  const url = `${WD_API}?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&type=item&limit=8&format=json&origin=*`
  const res = await fetch(url)
  return ((await res.json()).search ?? []) as any[]
}

function getClaimYear(claims: any, prop: string): string | null {
  const snak = claims?.[prop]?.[0]?.mainsnak
  if (!snak?.datavalue) return null
  const v = snak.datavalue.value
  if (snak.datavalue.type === 'time') return String(v.time).replace(/^\+/, '').substring(0, 4)
  return null
}

async function fetchEntityData(id: string) {
  const url = `${WD_API}?action=wbgetentities&ids=${id}&props=labels|descriptions|aliases|claims&languages=en|sv&format=json&origin=*`
  const entity = (await (await fetch(url)).json()).entities?.[id]
  if (!entity) throw new Error('Not found')
  const claims = entity.claims ?? {}
  const coord = claims.P625?.[0]?.mainsnak?.datavalue?.value
  return {
    id,
    label: entity.labels?.en?.value ?? entity.labels?.sv?.value ?? id,
    description: entity.descriptions?.en?.value ?? entity.descriptions?.sv?.value ?? '',
    aliases: [...(entity.aliases?.en ?? []), ...(entity.aliases?.sv ?? [])].map((a: any) => a.value),
    lat: coord?.latitude ?? null,
    lon: coord?.longitude ?? null,
    inception: getClaimYear(claims, 'P571'),
    dissolved: getClaimYear(claims, 'P576'),
  }
}

function WikidataSearch({ onSelect }: { onSelect: (d: any) => void }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const doSearch = async () => {
    if (!q.trim()) return
    setLoading(true)
    setResults(await searchWikidata(q))
    setLoading(false)
  }

  const doSelect = async (item: any) => {
    setLoadingId(item.id)
    const data = await fetchEntityData(item.id)
    setLoadingId(null)
    setResults([])
    setQ('')
    onSelect(data)
  }

  return (
    <div className={styles.wikidataWidget}>
      <div className={styles.wikidataRow}>
        <input value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder={t('places.wikidataSearchPlaceholder')} />
        <button className="btn btn-secondary btn-sm" onClick={doSearch}
          disabled={loading || !q.trim()}>
          {loading ? <Loader size={13} className={styles.spin} /> : <Search size={13} />}
        </button>
      </div>
      {results.length > 0 && (
        <div className={styles.wikidataResults}>
          {results.map(item => (
            <button key={item.id} className={styles.wikidataResult}
              onClick={() => doSelect(item)} disabled={loadingId === item.id}>
              <div className={styles.wikidataResultMain}>
                <span className={styles.wikidataResultName}>{item.label}</span>
                <code className={styles.wikidataResultId}>{item.id}</code>
                {loadingId === item.id && <Loader size={11} className={styles.spin} />}
              </div>
              {item.description && (
                <div className={styles.wikidataResultDesc}>{item.description}</div>
              )}
            </button>
          ))}
          <button className={styles.wikidataResultClear} onClick={() => setResults([])}>
            <X size={11} /> {t('places.clear')}
          </button>
        </div>
      )}
    </div>
  )
}

function PlaceForm({ placeTypes, onSave, onCancel, isSaving, initial }: {
  placeTypes: any[]; onSave: (d: Record<string, unknown>) => void
  onCancel: () => void; isSaving: boolean; initial?: any
}) {
  const { t } = useTranslation()
  const def = placeTypes[0]?.name ?? ''
  const [f, setF] = useState({
    place_type: initial?.place_type ?? def,
    name: initial?.name ?? '',
    wikidata_id: initial?.wikidata_id ?? '',
    lat: initial?.lat != null ? String(initial.lat) : '',
    lon: initial?.lon != null ? String(initial.lon) : '',
    note: initial?.note ?? '',
    date_from: initial?.date_from ?? '',
    date_to: initial?.date_to ?? '',
  })
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF(p => ({ ...p, [k]: e.target.value }))

  const onWikidata = (d: any) => setF(p => ({
    ...p,
    name: d.label,
    wikidata_id: d.id,
    lat: d.lat != null ? String(d.lat) : p.lat,
    lon: d.lon != null ? String(d.lon) : p.lon,
    date_from: p.date_from || d.inception || '',
    date_to: p.date_to || d.dissolved || '',
    note: p.note || d.description || '',
  }))

  return (
    <div className={styles.form}>
      <div className={styles.formSection}>
        <div className={styles.formSectionLabel}>{t('places.wikidataLookup')}</div>
        <WikidataSearch onSelect={onWikidata} />
        <p className={styles.formHint}>
          {t('places.wikidataAutofillHint')}
        </p>
      </div>

      <div className={styles.formGrid2}>
        <div className="form-group">
          <label>{t('places.type')}</label>
          <select value={f.place_type} onChange={set('place_type')}>
            {placeTypes.map(pt => <option key={pt.name} value={pt.name}>{pt.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>{t('places.placeName')}</label>
          <input value={f.name} onChange={set('name')} placeholder={t('places.placeNamePlaceholder')} />
        </div>
      </div>

      <div className={styles.formGrid2}>
        <div className="form-group">
          <label>{t('places.dateFrom')}</label>
          <input value={f.date_from} onChange={set('date_from')} placeholder="YYYY or YYYY-MM-DD" />
          <span className="form-hint">{t('places.dateFromHint')}</span>
        </div>
        <div className="form-group">
          <label>{t('places.dateTo')}</label>
          <input value={f.date_to} onChange={set('date_to')} placeholder="YYYY or YYYY-MM-DD" />
          <span className="form-hint">{t('places.dateToHint')}</span>
        </div>
      </div>

      <div className={styles.formSection}>
        <div className={styles.formSectionLabel}>{t('places.coordinates')}</div>
        <div className={styles.formGrid3}>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>{t('places.wikidataId')}</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input value={f.wikidata_id} onChange={set('wikidata_id')}
                placeholder="Q2022" style={{ fontFamily: 'var(--font-mono)' }} />
              {f.wikidata_id && (
                <a href={`https://www.wikidata.org/wiki/${f.wikidata_id}`}
                  target="_blank" rel="noreferrer" className={styles.wikidataLink}>
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
          </div>
          <div className="form-group">
            <label>{t('places.latitude')}</label>
            <input type="number" step="any" value={f.lat} onChange={set('lat')} placeholder="57.7089" />
          </div>
          <div className="form-group">
            <label>{t('places.longitude')}</label>
            <input type="number" step="any" value={f.lon} onChange={set('lon')} placeholder="11.9746" />
          </div>
          {f.lat && f.lon && (
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 'var(--space-2)' }}>
              <a href={`https://www.openstreetmap.org/?mlat=${f.lat}&mlon=${f.lon}&zoom=12`}
                target="_blank" rel="noreferrer" className={styles.mapLink}>
                {t('places.viewOnMap')}
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="form-group">
        <label>{t('places.noteLabel')}</label>
        <input value={f.note} onChange={set('note')} placeholder={t('places.notePlaceholder')} />
      </div>

      <div className={styles.formActions}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn btn-primary btn-sm"
          disabled={!f.name.trim() || !f.place_type || isSaving}
          onClick={() => onSave({
            place_type: f.place_type, name: f.name.trim(),
            wikidata_id: f.wikidata_id.trim() || null,
            lat: f.lat ? parseFloat(f.lat) : null,
            lon: f.lon ? parseFloat(f.lon) : null,
            note: f.note.trim() || null,
            date_from: f.date_from.trim() || null,
            date_to: f.date_to.trim() || null,
          })}>
          {isSaving ? <Spinner size={13} /> : <Check size={13} />}
          {initial ? t('resources.form.saveChanges') : t('places.addPlace')}
        </button>
      </div>
    </div>
  )
}

function PlaceRow({ place, placeTypes, entityType, entityId, onChanged }: {
  place: any; placeTypes: any[]; entityType: 'node' | 'agent'; entityId: number; onChanged: () => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      entityType === 'node'
        ? placesApi.updateNodePlace(entityId, place.id, data)
        : placesApi.updateAgentPlace(entityId, place.id, data),
    onSuccess: () => { setEditing(false); onChanged() },
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      entityType === 'node'
        ? placesApi.deleteNodePlace(entityId, place.id)
        : placesApi.deleteAgentPlace(entityId, place.id),
    onSuccess: onChanged,
  })

  if (editing) return (
    <div className={styles.placeCard}>
      <PlaceForm placeTypes={placeTypes} initial={place}
        onSave={d => updateMutation.mutate(d)}
        onCancel={() => setEditing(false)} isSaving={updateMutation.isPending} />
    </div>
  )

  const dateRange = [place.date_from, place.date_to].filter(Boolean).join('–') || null

  return (
    <div className={styles.placeCard}>
      <div className={styles.placeHeader}>
        <div className={styles.placeHeaderLeft}>
          <span className={styles.placeTypeTag}>{place.place_type_label}</span>
          {dateRange && <span className={styles.placeDates}>{dateRange}</span>}
        </div>
        <div className={styles.placeActions}>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(true)}><Pencil size={12} /></button>
          <button className="btn btn-ghost btn-sm btn-icon"
            onClick={() => { if (confirm(t('places.deleteConfirm'))) deleteMutation.mutate() }}><X size={12} /></button>
        </div>
      </div>
      <div className={styles.placeName}>
        <MapPin size={13} />
        <span>{place.name}</span>
        {place.wikidata_id && (
          <a href={`https://www.wikidata.org/wiki/${place.wikidata_id}`}
            target="_blank" rel="noreferrer" className={styles.wikidataLink}>
            <ExternalLink size={11} /><span>{place.wikidata_id}</span>
          </a>
        )}
      </div>
      {place.lat !== null && place.lon !== null && (
        <div className={styles.placeCoords}>
          <span>{Number(place.lat).toFixed(4)}, {Number(place.lon).toFixed(4)}</span>
          <a href={`https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}&zoom=12`}
            target="_blank" rel="noreferrer" className={styles.mapLink}>{t('places.viewOnMap')}</a>
        </div>
      )}
      {place.note && <div className={styles.placeNote}>{place.note}</div>}
    </div>
  )
}

export default function PlacesPanel({ entityType, entityId }: {
  entityType: 'node' | 'agent'; entityId: number
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)

  const { data: placeTypes = [] } = useQuery({
    queryKey: ['place-types', entityType],
    queryFn: () => vocabApi.listPlaceTypes(entityType).then(r => r.data.data),
  })

  const queryKey = [entityType === 'node' ? 'node-places' : 'agent-places', entityId]

  const { data: places, isLoading } = useQuery({
    queryKey,
    queryFn: () => entityType === 'node'
      ? placesApi.getNodePlaces(entityId).then(r => r.data.data)
      : placesApi.getAgentPlaces(entityId).then(r => r.data.data),
  })

  const addMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      entityType === 'node'
        ? placesApi.addNodePlace(entityId, data)
        : placesApi.addAgentPlace(entityId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); setAdding(false) },
  })

  if (isLoading) return <div style={{ padding: 'var(--space-4)' }}><Spinner size={16} /></div>

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}><MapPin size={14} /> {t('resources.tabs.places')}</span>
        {!adding && (
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
            <Plus size={13} /> {t('places.addPlace')}
          </button>
        )}
      </div>
      {adding && (
        <div className={styles.placeCard} style={{ background: 'var(--color-bg-subtle)' }}>
          <PlaceForm placeTypes={placeTypes}
            onSave={data => addMutation.mutate(data)}
            onCancel={() => setAdding(false)} isSaving={addMutation.isPending} />
        </div>
      )}
      {(!places || places.length === 0) && !adding && (
        <p className={styles.empty}>{t('places.noneRecorded')}</p>
      )}
      {places?.map((place: any) => (
        <PlaceRow key={place.id} place={place} placeTypes={placeTypes}
          entityType={entityType} entityId={entityId}
          onChanged={() => queryClient.invalidateQueries({ queryKey })} />
      ))}
    </div>
  )
}