import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Fingerprint, Plus, Pencil, Trash2, Save, X, Zap, Link2 } from 'lucide-react'
import { identifierSchemesApi } from '@/api'
import { Spinner } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import styles from './IdentifierSchemesTab.module.css'

interface SchemeForm {
  name: string
  description: string
  url_template: string
  generator_url: string
  generator_shoulder: string
  target_url_template: string
  generator_response_path: string
  generator_headers_text: string
  generator_body_text: string
}

const EMPTY: SchemeForm = {
  name: '', description: '', url_template: '', generator_url: '',
  generator_shoulder: '', target_url_template: '', generator_response_path: '',
  generator_headers_text: '', generator_body_text: '',
}

function SchemeEditor({ initial, onSave, onCancel, saving }: {
  initial: SchemeForm
  onSave: (form: SchemeForm) => void
  onCancel: () => void
  saving: boolean
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<SchemeForm>(initial)
  const [jsonError, setJsonError] = useState('')
  const set = (k: keyof SchemeForm, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = () => {
    setJsonError('')
    let headers: any = undefined
    let body: any = undefined
    try {
      if (form.generator_headers_text.trim())
        headers = JSON.parse(form.generator_headers_text)
    } catch {
      setJsonError(t('admin.identifierSchemes.headersInvalid')); return
    }
    try {
      if (form.generator_body_text.trim())
        body = JSON.parse(form.generator_body_text)
    } catch {
      setJsonError(t('admin.identifierSchemes.bodyInvalid')); return
    }
    onSave({ ...form, _headers: headers, _body: body } as any)
  }

  return (
    <div className={styles.editor}>
      <div className={styles.editorGrid}>
        <div className="form-group">
          <label>{t('agents.form.name')}</label>
          <input value={form.name} onChange={e => set('name', e.target.value)}
            placeholder={t('admin.identifierSchemes.namePlaceholder')} autoFocus />
        </div>
        <div className="form-group">
          <label>{t('resources.form.fields.description')}</label>
          <input value={form.description} onChange={e => set('description', e.target.value)}
            placeholder={t('identifiers.notePlaceholder')} />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label><Link2 size={12} /> {t('admin.identifierSchemes.resolverUrlTemplate')}</label>
          <input value={form.url_template} onChange={e => set('url_template', e.target.value)}
            placeholder="https://n2t.net/{value}" />
          <span className="form-hint">
            {t('admin.identifierSchemes.resolverHint')}
          </span>
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label><Zap size={12} /> {t('admin.identifierSchemes.generatorServiceUrl')}</label>
          <input value={form.generator_url} onChange={e => set('generator_url', e.target.value)}
            placeholder="https://my-pid-service.example/api/pids/mint" />
          <span className="form-hint">
            {t('admin.identifierSchemes.generatorUrlHint')}
          </span>
        </div>

        {form.generator_url.trim() && (<>
          <div className="form-group">
            <label>{t('admin.identifierSchemes.shoulderNamespace')}</label>
            <input value={form.generator_shoulder} onChange={e => set('generator_shoulder', e.target.value)}
              placeholder="e.g. prod-dataset" />
            <span className="form-hint">{t('admin.identifierSchemes.shoulderHint')}</span>
          </div>
          <div className="form-group">
            <label>{t('admin.identifierSchemes.responsePath')}</label>
            <input value={form.generator_response_path} onChange={e => set('generator_response_path', e.target.value)}
              placeholder="e.g. pid or data.identifier" />
            <span className="form-hint">{t('admin.identifierSchemes.responsePathHint')}</span>
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>{t('admin.identifierSchemes.targetUrlTemplate')}</label>
            <input value={form.target_url_template} onChange={e => set('target_url_template', e.target.value)}
              placeholder="https://mycatalog.example/records/{ref_code}" />
            <span className="form-hint">
              {t('admin.identifierSchemes.targetUrlHint')}
            </span>
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>{t('admin.identifierSchemes.headersJson')}</label>
            <textarea value={form.generator_headers_text}
              onChange={e => set('generator_headers_text', e.target.value)}
              rows={3} className={styles.monoArea} spellCheck={false}
              placeholder={'{\n  "Authorization": "Bearer <token>"\n}'} />
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>{t('admin.identifierSchemes.requestBodyTemplate')}</label>
            <textarea value={form.generator_body_text}
              onChange={e => set('generator_body_text', e.target.value)}
              rows={5} className={styles.monoArea} spellCheck={false}
              placeholder={'{\n  "shoulder": "{shoulder}",\n  "target_url": "{target_url}",\n  "label": "{title}"\n}'} />
            <span className="form-hint">
              {t('admin.identifierSchemes.placeholdersHint')}
            </span>
          </div>
        </>)}

        {jsonError && (
          <div className={styles.jsonError} style={{ gridColumn: '1 / -1' }}>{jsonError}</div>
        )}
      </div>
      <div className={styles.editorActions}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn btn-primary btn-sm"
          disabled={!form.name.trim() || saving}
          onClick={handleSave}>
          {saving ? <Spinner size={13} /> : <Save size={13} />} {t('common.save')}
        </button>
      </div>
    </div>
  )
}

export default function IdentifierSchemesTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  const { data: schemes, isLoading } = useQuery({
    queryKey: ['identifier-schemes-admin'],
    queryFn: () => identifierSchemesApi.list(true).then(r => r.data.data),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['identifier-schemes-admin'] })
    queryClient.invalidateQueries({ queryKey: ['identifier-schemes'] })
  }

  const toPayload = (form: any) => ({
    name: form.name.trim(),
    description: form.description || null,
    url_template: form.url_template || null,
    generator_url: form.generator_url || null,
    generator_shoulder: form.generator_shoulder || null,
    target_url_template: form.target_url_template || null,
    generator_response_path: form.generator_response_path || null,
    generator_headers: form._headers ?? {},
    generator_body_template: form._body ?? {},
  })

  const createMutation = useMutation({
    mutationFn: (form: SchemeForm) => identifierSchemesApi.create(toPayload(form)),
    onSuccess: () => { invalidate(); setCreating(false) },
    onError: (err: any) => alert(err?.response?.data?.message ?? t('admin.identifierSchemes.couldNotCreate')),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, form }: { id: number; form: SchemeForm }) =>
      identifierSchemesApi.update(id, toPayload(form)),
    onSuccess: () => { invalidate(); setEditingId(null) },
    onError: (err: any) => alert(err?.response?.data?.message ?? t('admin.identifierSchemes.couldNotSave')),
  })
  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      identifierSchemesApi.update(id, { is_active }),
    onSuccess: invalidate,
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => identifierSchemesApi.delete(id),
    onSuccess: invalidate,
    onError: (err: any) => alert(err?.response?.data?.message ?? t('admin.identifierSchemes.couldNotDelete')),
  })

  if (isLoading) return <div className={styles.tab}><Spinner /></div>

  return (
    <div className={styles.tab}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.heading}><Fingerprint size={16} /> {t('admin.identifierSchemes.heading')}</h3>
          <p className={styles.sub}>
            {t('admin.identifierSchemes.subheading')}
          </p>
        </div>
        {!creating && (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Plus size={13} /> {t('admin.identifierSchemes.newScheme')}
          </button>
        )}
      </div>

      {creating && (
        <SchemeEditor
          initial={EMPTY}
          saving={createMutation.isPending}
          onSave={form => createMutation.mutate(form)}
          onCancel={() => setCreating(false)}
        />
      )}

      <div className={styles.list}>
        {(schemes ?? []).length === 0 && !creating && (
          <p className={styles.empty}>{t('admin.identifierSchemes.noneYet')}</p>
        )}
        {(schemes ?? []).map((s: any) => (
          editingId === s.id ? (
            <SchemeEditor
              key={s.id}
              initial={{
                name: s.name,
                description: s.description ?? '',
                url_template: s.url_template ?? '',
                generator_url: s.generator_url ?? '',
                generator_shoulder: s.generator_shoulder ?? '',
                target_url_template: s.target_url_template ?? '',
                generator_response_path: s.generator_response_path ?? '',
                generator_headers_text: s.generator_headers && Object.keys(s.generator_headers).length
                  ? JSON.stringify(s.generator_headers, null, 2) : '',
                generator_body_text: s.generator_body_template && Object.keys(s.generator_body_template).length
                  ? JSON.stringify(s.generator_body_template, null, 2) : '',
              }}
              saving={updateMutation.isPending}
              onSave={form => updateMutation.mutate({ id: s.id, form })}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div key={s.id} className={`${styles.row} ${!s.is_active ? styles.rowInactive : ''}`}>
              <div className={styles.rowMain}>
                <div className={styles.rowTop}>
                  <span className={styles.rowName}>{s.name}</span>
                  {s.has_generator && <span className={styles.tag}><Zap size={9} /> {t('admin.identifierSchemes.generatorTag')}</span>}
                  {s.url_template && <span className={styles.tag}><Link2 size={9} /> {t('admin.identifierSchemes.resolverTag')}</span>}
                  {!s.is_active && <span className={styles.inactiveTag}>{t('admin.identifierSchemes.inactiveTag')}</span>}
                </div>
                {s.description && <span className={styles.rowDesc}>{s.description}</span>}
              </div>
              <div className={styles.rowActions}>
                <label className={styles.toggle} title={s.is_active ? t('admin.identifierSchemes.activeTitle') : t('admin.identifierSchemes.inactiveTag')}>
                  <input type="checkbox" checked={s.is_active}
                    onChange={e => toggleMutation.mutate({ id: s.id, is_active: e.target.checked })} />
                </label>
                <button className="btn btn-ghost btn-sm btn-icon"
                  onClick={() => setEditingId(s.id)} title={t('common.edit')}>
                  <Pencil size={13} />
                </button>
                <button className="btn btn-ghost btn-sm btn-icon"
                  onClick={() => { if (confirm(t('admin.identifierSchemes.deleteConfirm', { name: s.name }))) deleteMutation.mutate(s.id) }}
                  title={t('common.delete')}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  )
}
