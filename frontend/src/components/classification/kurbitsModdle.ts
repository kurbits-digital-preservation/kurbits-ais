// ─── Kurbits BPMN moddle extension ────────────────────────────────────
// A <kurbits:recordMeta> element inside a data object's extensionElements
// carries records-management metadata + the link to a records classification.
// Stays inside standard BPMN 2.0 extensionElements.

export const KURBITS_PREFIX = 'kurbits'
export const KURBITS_NS = 'http://kurbits.example/schema/bpmn'
export const CLASSIFICATION_LINK_TYPE = KURBITS_PREFIX + ':ClassificationLink'

export const kurbitsModdleDescriptor = {
  name: 'Kurbits',
  uri: KURBITS_NS,
  prefix: KURBITS_PREFIX,
  xml: { tagAlias: 'lowerCase' },
  associations: [],
  types: [
    {
      name: 'ClassificationLink',
      superClass: ['Element'],
      properties: [
        { name: 'classificationId', isAttr: true, type: 'Integer' },
        { name: 'classificationCode', isAttr: true, type: 'String' },
        { name: 'classificationName', isAttr: true, type: 'String' },
        { name: 'retentionPeriod', isAttr: true, type: 'String' },
        { name: 'retentionRule', isAttr: true, type: 'String' },
        { name: 'disposalAction', isAttr: true, type: 'String' },
        { name: 'securityClass', isAttr: true, type: 'String' },
        { name: 'mediumFormat', isAttr: true, type: 'String' },
        { name: 'legalBasis', isAttr: true, type: 'String' },
        { name: 'recordDescription', isAttr: true, type: 'String' },
      ],
    },
  ],
}
